import test from 'node:test';
import assert from 'node:assert/strict';
import {inclusiveTotals,orderStatusForShipment,shipmentStatusForOrder} from '../src/lib/crm-calculations.ts';
import {newAdminAuth,passwordHash,sessionSignature,validSession} from '../src/lib/crm-crypto.ts';
test('699 inclusive price is never charged GST twice',()=>{
 assert.deepEqual(inclusiveTotals(1,69900,18),{gross:69900,subtotal:59237,gst:10663,total:69900});
 assert.equal(inclusiveTotals(2,69900,18,5000).total,144800);
 assert.equal(inclusiveTotals(1,69900,0).gst,0);
 for(const shipping of [-1,0.5,NaN])assert.throws(()=>inclusiveTotals(1,69900,18,shipping));
});
test('shipment and order states agree for delivery and RTO',()=>{
 for(const status of ['SHIPPED','OUT_FOR_DELIVERY','DELIVERED','RTO']){
  assert.equal(orderStatusForShipment(status),status);
  assert.equal(shipmentStatusForOrder(status),status);
 }
 assert.equal(orderStatusForShipment('READY'),null);
});
test('password change invalidates sessions and malformed cookies fail safely',async()=>{
 const old=await newAdminAuth('test-password-old');
 assert.equal(await passwordHash('test-password-old',old.salt),old.password_hash);
 assert.notEqual(await passwordHash('wrong',old.salt),old.password_hash);
 const secret=old.salt+':'+old.password_hash;
 const payload='admin.200';const token=payload+'.'+await sessionSignature(payload,secret);
 assert.equal(await validSession(token,secret,100),true);
 assert.equal(await validSession(token,secret,200),false);
 const changed=await newAdminAuth('test-password-new');
 assert.equal(await validSession(token,changed.salt+':'+changed.password_hash,100),false);
 for(const token of ['admin.300.%','admin.NaN.x','admin.300.x.y','admin.300.'])assert.equal(await validSession(token,secret,100),false);
});
