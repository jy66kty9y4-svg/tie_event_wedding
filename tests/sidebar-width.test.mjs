import test from 'node:test';
import assert from 'node:assert/strict';
import {clampSidebarWidth,sidebarMax} from '../src/ui/sidebar-width.mjs';

test('sidebar resizing retains navigation and stops at both desktop bounds',()=>{
 assert.equal(clampSidebarWidth(-200,1440),72);
 assert.equal(clampSidebarWidth(240,1440),240);
 assert.equal(clampSidebarWidth(2000,1440),320);
});
test('sidebar maximum leaves at least 440px for the workspace on tablet',()=>{
 for(const viewport of [768,800,1024])assert.ok(viewport-sidebarMax(viewport)>=440);
 assert.equal(clampSidebarWidth(320,700),260);
 assert.equal(clampSidebarWidth(240,375),72);
});
test('invalid or stale saved sidebar sizes return a usable rail',()=>{
 assert.equal(clampSidebarWidth(NaN,1440),72);
 assert.equal(clampSidebarWidth(Infinity,1440),72);
 assert.equal(clampSidebarWidth(240.6,1440),241);
});
