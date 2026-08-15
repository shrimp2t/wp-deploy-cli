<?php
/**
 * Plugin Name: WP Deploy Endpoint
 * Description: A REST API that the `wp-deploy-cli` tool calls to upload a built zip and
 *              set it as an EDD download's file + Software Licensing version/changelog.
 * Version: 1.0.0
 *
 * Install as a normal plugin (wp-content/plugins/) and activate it.
 *
 * Route:  POST /wp-json/wp-deploy/v1/download
 *
 * Auth (either is accepted):
 *   - A logged-in user who can edit the target download (Application Passwords work), OR
 *   - Authorization: Bearer <token>  matching a configured shared token.
 *
 * Configure the shared token (optional — for headless/CI without Application Passwords)
 * via a constant in wp-config.php:
 *   define( 'FD_API_TOKEN', 'your-long-random-secret' );
 * or via a filter:
 *   add_filter( 'fd_api_token', fn() => 'your-long-random-secret' );
 *
 * Storage note: files are written with wp_upload_bits() (filesystem only — no attachment
 * post is created), and only post meta is written, so this endpoint avoids the wp_posts /
 * wp_options tables entirely.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'wp-deploy/v1', '/download', array(
		'methods'             => 'POST',
		'callback'            => 'fd_api_handle_download',
		'permission_callback' => 'fd_api_permission',
		'args'                => array(
			'download_id' => array( 'required' => true ),
		),
	) );
} );

/**
 * Allow either a capable logged-in user (Application Password) or a matching bearer token.
 */
function fd_api_permission( WP_REST_Request $request ) {
	$download_id = absint( $request->get_param( 'download_id' ) );

	// 1) Capability-based (e.g. Application Password auth sets the current user).
	if ( $download_id && current_user_can( 'edit_post', $download_id ) ) {
		return true;
	}
	if ( current_user_can( 'manage_options' ) ) {
		return true;
	}

	// 2) Shared token (constant or `fd_api_token` filter).
	$token = apply_filters( 'fd_api_token', defined( 'FD_API_TOKEN' ) ? FD_API_TOKEN : '' );
	if ( $token ) {
		$auth = $request->get_header( 'authorization' );
		if ( $auth && preg_match( '/Bearer\s+(.+)/i', $auth, $m ) ) {
			if ( hash_equals( (string) $token, trim( $m[1] ) ) ) {
				return true;
			}
		}
	}

	return new WP_Error( 'fd_forbidden', 'Not allowed.', array( 'status' => 403 ) );
}

function fd_api_handle_download( WP_REST_Request $request ) {
	$download_id = absint( $request->get_param( 'download_id' ) );
	if ( ! $download_id || 'download' !== get_post_type( $download_id ) ) {
		return new WP_Error( 'fd_bad_download', 'Invalid or missing EDD download_id.', array( 'status' => 400 ) );
	}

	$version   = sanitize_text_field( (string) $request->get_param( 'version' ) );
	$changelog = wp_kses_post( (string) $request->get_param( 'changelog' ) );
	$file_name = sanitize_file_name( (string) $request->get_param( 'file_name' ) );

	// --- obtain the file bytes: multipart upload OR a URL to download ---------
	$contents = null;
	$files    = $request->get_file_params();
	if ( ! empty( $files['file']['tmp_name'] ) ) {
		if ( ! $file_name ) {
			$file_name = sanitize_file_name( $files['file']['name'] );
		}
		$contents = file_get_contents( $files['file']['tmp_name'] );
	} else {
		$file_url = esc_url_raw( (string) $request->get_param( 'file_url' ) );
		if ( $file_url ) {
			$resp = wp_remote_get( $file_url, array( 'timeout' => 60 ) );
			if ( is_wp_error( $resp ) || 200 !== wp_remote_retrieve_response_code( $resp ) ) {
				return new WP_Error( 'fd_fetch_failed', 'Could not fetch file_url.', array( 'status' => 400 ) );
			}
			$contents = wp_remote_retrieve_body( $resp );
			if ( ! $file_name ) {
				$file_name = sanitize_file_name( basename( wp_parse_url( $file_url, PHP_URL_PATH ) ) );
			}
		}
	}

	if ( null === $contents || '' === $contents ) {
		return new WP_Error( 'fd_no_file', 'Provide a "file" upload or a "file_url".', array( 'status' => 400 ) );
	}
	if ( ! $file_name ) {
		$file_name = 'download-' . $download_id . '.zip';
	}
	// Only allow zip.
	if ( ! preg_match( '/\.zip$/i', $file_name ) ) {
		return new WP_Error( 'fd_bad_type', 'Only .zip files are accepted.', array( 'status' => 400 ) );
	}

	// --- write to uploads (filesystem only — NO attachment post) --------------
	$upload = wp_upload_bits( $file_name, null, $contents );
	if ( ! empty( $upload['error'] ) ) {
		return new WP_Error( 'fd_upload_failed', $upload['error'], array( 'status' => 500 ) );
	}

	// --- set the EDD download file (postmeta) ---------------------------------
	$existing = get_post_meta( $download_id, 'edd_download_files', true );
	if ( ! is_array( $existing ) ) {
		$existing = array();
	}
	$existing[0] = array(
		'index'          => '0',
		'attachment_id'  => 0,
		'thumbnail_size' => false,
		'name'           => $file_name,
		'file'           => $upload['url'],
		'condition'      => 'all',
	);
	$meta_ok = update_post_meta( $download_id, 'edd_download_files', $existing );

	// --- Software Licensing version + changelog (postmeta) --------------------
	if ( $version ) {
		update_post_meta( $download_id, '_edd_sl_version', $version );
	}
	if ( $changelog ) {
		update_post_meta( $download_id, '_edd_sl_changelog', $changelog );
	}

	return new WP_REST_Response( array(
		'ok'          => true,
		'download_id' => $download_id,
		'file'        => $upload['url'],
		'file_path'   => $upload['file'],
		'version'     => $version,
		'meta_saved'  => (bool) $meta_ok || null !== $meta_ok,
	), 200 );
}
