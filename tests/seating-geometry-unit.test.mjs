import test from 'node:test';
import assert from 'node:assert/strict';
import {tableOutline,seatPositions,rotatedExtents,clampPosition} from '../src/v2/guest/geometry.mjs';
import {outlineOnPlan,removeContourPoint,geometryDraft,quarterTurn} from '../src/v2/guest/interaction.mjs';

const close=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const rectangle=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
for(const [name,points] of [
  ['too few',[{x:0,y:0},{x:1,y:1}]],['too many',Array.from({length:65},()=>({x:0,y:0}))],
  ['duplicate vertices',[...rectangle,rectangle[0]]],['outside unit bounds',[{x:-.01,y:0},{x:1,y:0},{x:1,y:1}]],
  ['nonfinite',[{x:NaN,y:0},{x:1,y:0},{x:1,y:1}]],['degenerate',[{x:0,y:0},{x:.5,y:.5},{x:1,y:1}]],
  ['self crossing',[{x:0,y:0},{x:1,y:1},{x:0,y:1},{x:1,y:0}]],
  ['nonadjacent touching',[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:.5,y:0},{x:0,y:1}]]
])test(`invalid seating contour is rejected: ${name}`,()=>assert.equal(tableOutline({shape:'custom',points}),null));
test('valid concave and reversed contours are owned copies and do not get replaced with a rectangle',()=>{
  for(const points of [rectangle,[...rectangle].reverse(),[{x:0,y:0},{x:1,y:0},{x:.5,y:.5},{x:1,y:1},{x:0,y:1}]]) {
    const result=tableOutline({shape:'custom',points});assert.deepEqual(result,points);result[0].x=.25;assert.notEqual(result[0].x,points[0].x);
  }
  assert.equal(tableOutline({shape:'rect',points:rectangle}),null);assert.equal(tableOutline(null),null);
});
for(const shape of ['round','round150','oval','rect','custom','snakeQuarter'])test(`seat positions are finite, unique and independent of rotation for ${shape}`,()=>{
  const data={shape,widthM:3,heightM:2,capacity:18,points:rectangle},positions=seatPositions(data);
  assert.equal(positions.length,18);assert(positions.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
  assert.equal(new Set(positions.map(p=>`${p.x}:${p.y}`)).size,18);
  assert.deepEqual(seatPositions({...data,rotationDeg:90}),positions);
  assert.deepEqual(seatPositions({...data,capacity:0}),[]);assert.deepEqual(seatPositions({...data,widthM:0}),[]);
});
test('rectangular and elliptical extents follow independent known quarter-turn dimensions',()=>{
  for(const shape of ['rect','oval','custom']) {
    const data={shape,widthM:4,heightM:2,rotationDeg:90},extents=rotatedExtents(data);close(extents.width,2);close(extents.height,4);
    const zero=rotatedExtents({...data,rotationDeg:0});close(zero.width,4);close(zero.height,2);
  }
  const diagonal=rotatedExtents({shape:'rect',widthM:4,heightM:2,rotationDeg:45});close(diagonal.width,3*Math.SQRT2);close(diagonal.height,3*Math.SQRT2);
  const circle=rotatedExtents({shape:'round',widthM:2,heightM:2,rotationDeg:37});close(circle.width,2);close(circle.height,2);
});
test('clamping keeps rotated bodies inside the floor and is idempotent over deterministic angles and extreme drags',()=>{
  const plan={widthM:20,heightM:15};
  for(const shape of ['rect','oval','custom'])for(let angle=0;angle<360;angle+=15)for(const [x,y] of [[-100,-100],[100,100],[5,7],[0,15]]) {
    const d={shape,widthM:4,heightM:2,rotationDeg:angle},pos=clampPosition(d,plan,x,y),extent=rotatedExtents(d),center={x:pos.x+2,y:pos.y+1};
    assert(center.x-extent.width/2>=-1e-8);assert(center.y-extent.height/2>=-1e-8);assert(center.x+extent.width/2<=20+1e-8);assert(center.y+extent.height/2<=15+1e-8);
    const again=clampPosition(d,plan,pos.x,pos.y);close(pos.x,again.x);close(pos.y,again.y);
  }
});
test('four quarter turns restore interior coordinates, preserve area and never mutate the saved geometry',()=>{
  const saved={shape:'custom',widthM:4,heightM:2,xM:5,yM:5,rotationDeg:0,points:rectangle},before=structuredClone(saved);let next=saved;
  for(let i=0;i<4;i++)next=quarterTurn(next,90,{widthM:20,heightM:20});
  close(next.xM,5);close(next.yM,5);assert.equal(next.rotationDeg,0);assert.equal(next.widthM*next.heightM,8);assert.deepEqual(saved,before);
  const outline=outlineOnPlan({...saved,rotationDeg:90});close(outline[0].x,8);close(outline[0].y,4);
});
test('contour deletion reopens incomplete drawings and numeric previews retain invalid input until strict save',()=>{
  const drawing={points:rectangle,selected:2,closed:true},removed=removeContourPoint(drawing);assert.equal(removed.points.length,3);assert.equal(removed.closed,true);assert.equal(removed.selected,null);assert.equal(drawing.points.length,4);
  assert.equal(removeContourPoint({...removed,selected:1}).closed,false);assert.equal(removeContourPoint(null),null);assert.equal(removeContourPoint({...drawing,selected:null}).points,rectangle);
  const saved={xM:1,yM:2,widthM:3,heightM:4,capacity:0};assert.equal(geometryDraft(saved,{widthM:''}).widthM,3);assert.equal(geometryDraft(saved,{capacity:'0'}).capacity,0);assert.equal(geometryDraft(saved,{xM:'2.5'}).xM,2.5);
  for(const value of ['',0,-1,NaN,Infinity])assert.throws(()=>geometryDraft(saved,{widthM:value},true));
});
