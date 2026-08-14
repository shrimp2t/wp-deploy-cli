import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Finder } from '../src/finder.js';

// --- PHP if/else collapse -----------------------------------------------------

const PHP_SRC = `<?php

function ft_is__premium() {
    return true;
}

if ( ft_is__premium() ){
    $array = array( 'string' => 'this is pro string' );
    function get_content(){ /* pro */ }
} else {
    $array = array( 'string' => 'this is free version' );
    function get_content(){ /* free */ }
}
`;

test('php free: keeps free branch, drops pro + marker fn', () => {
  const out = new Finder({ variant: 'free' }).deployPhp(PHP_SRC);
  assert.ok(out.includes('this is free version'));
  assert.ok(!out.includes('this is pro string'));
  assert.ok(!out.includes('ft_is__premium'));
});

test('php premium: keeps pro branch, drops free + marker fn', () => {
  const out = new Finder({ variant: 'premium' }).deployPhp(PHP_SRC);
  assert.ok(out.includes('this is pro string'));
  assert.ok(!out.includes('this is free version'));
  assert.ok(!out.includes('ft_is__premium'));
});

test('negated condition: `! ft_is__premium()` then-branch is free', () => {
  const src = `<?php if ( ! ft_is__premium() ) { echo 'FREE'; } else { echo 'PRO'; }`;
  assert.ok(new Finder({ variant: 'free' }).resolveConditionals(src).includes('FREE'));
  assert.ok(new Finder({ variant: 'premium' }).resolveConditionals(src).includes('PRO'));
});

test('== true / != true handled', () => {
  const t = `<?php if ( ft_is__premium() == true ) { echo 'PRO'; } else { echo 'FREE'; }`;
  assert.ok(new Finder({ variant: 'premium' }).resolveConditionals(t).includes('PRO'));
  const nt = `<?php if ( ft_is__premium() != true ) { echo 'FREE'; } else { echo 'PRO'; }`;
  assert.ok(new Finder({ variant: 'free' }).resolveConditionals(nt).includes('FREE'));
});

test('if without else: free drops premium-only block', () => {
  const src = `<?php before(); if ( ft_is__premium() ) { pro_only(); } after();`;
  const free = new Finder({ variant: 'free' }).resolveConditionals(src);
  assert.ok(!free.includes('pro_only'));
  assert.ok(free.includes('before()') && free.includes('after()'));
  const pro = new Finder({ variant: 'premium' }).resolveConditionals(src);
  assert.ok(pro.includes('pro_only'));
});

test('nested if(key) inside a branch is resolved', () => {
  const src = `<?php if ( ft_is__premium() ) { if ( ft_is__premium() ) { deep_pro(); } } else { free_x(); }`;
  const pro = new Finder({ variant: 'premium' }).resolveConditionals(src);
  assert.ok(pro.includes('deep_pro'));
  const free = new Finder({ variant: 'free' }).resolveConditionals(src);
  assert.ok(free.includes('free_x') && !free.includes('deep_pro'));
});

test('brace inside a string does not break matching', () => {
  const src = `<?php if ( ft_is__premium() ) { $x = "a } b"; pro(); } else { free(); }`;
  const pro = new Finder({ variant: 'premium' }).resolveConditionals(src);
  assert.ok(pro.includes('pro()') && pro.includes('a } b'));
  assert.ok(!pro.includes('free()'));
});

// --- comment / html marker tags ----------------------------------------------

test('css marker: free strips block, pro unwraps tags', () => {
  const css = `body{}\n/*<if_is_premium>*/\n.pro{color:red}\n/*</if_is_premium>*/\n`;
  const free = new Finder({ variant: 'free' }).deployText(css);
  assert.ok(!free.includes('.pro'));
  const pro = new Finder({ variant: 'premium' }).deployText(css);
  assert.ok(pro.includes('.pro') && !pro.includes('if_is_premium'));
});

test('html marker tags', () => {
  const html = `<div><!-- if_is_premium --><span>PRO</span><!-- /if_is_premium --></div>`;
  assert.ok(!new Finder({ variant: 'free' }).deployText(html).includes('PRO'));
  const pro = new Finder({ variant: 'premium' }).deployText(html);
  assert.ok(pro.includes('PRO') && !pro.includes('if_is_premium'));
});

// --- custom marker function name ---------------------------------------------

test('custom marker function name via key', () => {
  const src = `<?php if ( easymag_is__premium() ) { pro(); } else { free(); }`;
  const f = new Finder({ variant: 'free', key: 'easymag_is__premium' });
  assert.ok(f.resolveConditionals(src).includes('free()'));
});
