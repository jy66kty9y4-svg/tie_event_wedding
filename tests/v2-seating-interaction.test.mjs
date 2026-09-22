import test from 'node:test';
import assert from 'node:assert/strict';
import { batchTables, dragPosition, drawnTable, nextTableNumber, tableFromPreset } from '../src/v2/guest/interaction.mjs';

const plan = { widthM: 10, heightM: 8 };
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-8, `${actual} is not close to ${expected}`);

test('batch tables preserve zero capacity and skip occupied labels while filling available label holes', () => {
  const tables = [{ data: { label: 'Стол 1' } }, { data: { label: 'Стол 3' } }];
  const result = batchTables(tables, [], plan, { count: 2, capacity: 0, shape: 'round', prefix: 'Стол', startNumber: 1 });
  assert.deepEqual(result.map(table => table.label), ['Стол 2', 'Стол 4']);
  assert.deepEqual(result.map(table => table.capacity), [0, 0]);
  assert.equal(nextTableNumber(tables, 'Стол'), 4);
});

test('five table choices include exact requested sizes and a quarter-circle snake',()=>{
 assert.deepEqual(tableFromPreset('round150'),{shape:'round150',widthM:1.5,heightM:1.5,preset:'round150',points:undefined});
 assert.deepEqual(tableFromPreset('round'),{shape:'round',widthM:1.8,heightM:1.8,preset:'round',points:undefined});
 assert.deepEqual(tableFromPreset('rect'),{shape:'rect',widthM:1.8,heightM:.9,preset:'rect',points:undefined});
 const snake=tableFromPreset('snakeQuarter');assert.equal(snake.shape,'snakeQuarter');assert.equal(snake.widthM,2.4);assert(snake.points.length>=8);
});

test('batch tables place new tables away from occupied tables and zones and explain an exhausted plan', () => {
  const existing = [{ data: { label: 'Стол 1', shape: 'round', xM: .3, yM: .3, widthM: 1.6, heightM: 1.6, rotationDeg: 0 } }];
  const zones = [{ label: 'Танцпол', xM: 2.5, yM: .3, widthM: 2, heightM: 2, rotationDeg: 0 }];
  const [created] = batchTables(existing, zones, { widthM: 9, heightM: 6 }, { count: 1, capacity: 6, shape: 'round', prefix: 'Стол', startNumber: 2 });
  assert(created.xM >= 4.75, `new table overlaps reserved space at x=${created.xM}`);
  assert.equal(created.yM, .3);
  assert.throws(() => batchTables([], [{ xM: .3, yM: .3, widthM: 1.6, heightM: 1.6 }], { widthM: 2, heightM: 2 }, { count: 1, capacity: 0, shape: 'round', prefix: 'Стол', startNumber: 1 }), /не хватает свободного места/);
});

test('drag position follows plan deltas across scroll offsets and zoom ratios without vertical drift', () => {
  const session = { data: { shape: 'rect', xM: 2, yM: 3, widthM: 2, heightM: 1, rotationDeg: 0 }, startPoint: { x: 4, y: 3 } };
  const base = dragPosition(session, 600, 500, { left: 100, top: 200, width: 1000, height: 800 }, plan);
  assert.deepEqual(base, { xM: 3, yM: 3 });
  const afterScroll = dragPosition(session, 540, 460, { left: 40, top: 160, width: 1000, height: 800 }, plan);
  assert.deepEqual(afterScroll, base);
  const zoomed = dragPosition(session, 1100, 800, { left: 100, top: 200, width: 2000, height: 1600 }, plan);
  assert.deepEqual(zoomed, base);
});

test('drag position clamps a rotated table by its rotated bounds', () => {
  const session = { data: { shape: 'custom', xM: 3, yM: 3, widthM: 2, heightM: 1, rotationDeg: 45, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }, startPoint: { x: 0, y: 0 } };
  const result = dragPosition(session, -200, -200, { left: 0, top: 0, width: 10, height: 8 }, plan);
  close(result.xM, Math.sqrt(4.5) / 2 - 1);
  close(result.yM, Math.sqrt(4.5) / 2 - .5);
});

test('drawn table normalizes its contour and enforces a visible minimum size', () => {
  const table = drawnTable([{ x: 2, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 5 }], 'Нарисованный', 0);
  assert.deepEqual(table, { label: 'Нарисованный', capacity: 0, shape: 'custom', xM: 2, yM: 3, widthM: 2, heightM: 2, rotationDeg: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: .5, y: 1 }] });
  assert.throws(() => drawnTable([{ x: 0, y: 0 }, { x: .1, y: 0 }, { x: 0, y: .1 }], 'Маленький', 0), /не меньше 40 см/);
});

test('numeric drafts preserve empty input without making a zero-size preview',async()=>{
 const {geometryDraft}=await import('../src/v2/guest/interaction.mjs');
 const saved={widthM:2,heightM:1,xM:0,yM:0,capacity:8};
 assert.equal(geometryDraft(saved,{widthM:''}).widthM,2);
 assert.equal(geometryDraft(saved,{widthM:'3.5',capacity:'0'}).widthM,3.5);
 assert.equal(geometryDraft(saved,{capacity:'0'},true).capacity,0);
 assert.throws(()=>geometryDraft(saved,{widthM:''},true),/Заполните/);
});

test('deleting a selected contour vertex retains other vertices and opens undersized contours',async()=>{
 const {removeContourPoint,outlineOnPlan}=await import('../src/v2/guest/interaction.mjs');
 const points=[{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}];
 const result=removeContourPoint({points,closed:true,selected:1});
 assert.deepEqual(result.points,[points[0],points[2],points[3]]);
 assert.equal(result.closed,true);
 assert.equal(removeContourPoint({...result,selected:0}).closed,false);
 const world=outlineOnPlan({xM:1,yM:1,widthM:2,heightM:2,rotationDeg:90,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}]});
 close(world[0].x,3);close(world[0].y,1);
});
