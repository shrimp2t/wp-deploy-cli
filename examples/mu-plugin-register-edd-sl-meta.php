<?php
/**
 * Plugin Name: Freemium Deploy — expose EDD SL meta to REST
 * Description: Minimal glue so `deploy-version` can write the Software Licensing
 *              version/changelog through the EXISTING WordPress core REST endpoint
 *              (/wp-json/wp/v2/edd-downloads/<id>). It adds NO new route/controller —
 *              it only registers already-existing meta keys for REST, gated by the
 *              edit_post capability. Drop this file in wp-content/mu-plugins/.
 */

add_action( 'init', function () {

	$fields = array(
		'_edd_sl_version'   => 'string',
		'_edd_sl_changelog' => 'string',
		// Optional: a plain URL you can store for your own use.
		'_fdeploy_file_url' => 'string',
	);

	foreach ( $fields as $key => $type ) {
		register_post_meta( 'download', $key, array(
			'type'          => $type,
			'single'        => true,
			'show_in_rest'  => true,
			'auth_callback' => function ( $allowed, $meta_key, $post_id ) {
				return current_user_can( 'edit_post', $post_id );
			},
		) );
	}
}, 20 );

/*
 * Why this is needed (and why it is not a "new endpoint"):
 *
 * EDD already registers the `download` post type with show_in_rest => true and
 * rest_base => "edd-downloads", so WP core's own controller serves
 *     POST /wp-json/wp/v2/edd-downloads/<id>
 * out of the box. But `_edd_sl_version` / `_edd_sl_changelog` are PROTECTED meta
 * (leading underscore) and are not registered for REST, so WP refuses to write
 * them. The snippet above simply opts those existing keys into the existing
 * endpoint — no register_rest_route(), no controller, no custom URL.
 *
 * `edd_download_files` is a serialized array; if you also want to set it over
 * REST, register it with an 'object'/'array' schema here. For auto-update
 * notifications, `_edd_sl_version` (+ changelog) are what matter.
 */
