import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import bcrypt from 'bcryptjs';

// Resolve app aliases and replace only Supabase with the local SQL adapter.
const root = new URL('../',import.meta.url);
const fixtureURL = new URL('./support/isolated-supabase.mjs',import.meta.url).href;
const hooks=registerHooks({ resolve(specifier,context,next) {
  if(specifier==='next/server')return next('next/server.js',context);
  const target=specifier.startsWith('@/')?new URL(specifier.slice(2)+(specifier.endsWith('.js')?'':'.js'),root).href
    :specifier.startsWith('.')?new URL(specifier,context.parentURL).href:null;
  if(target===new URL('lib/supabase.js',root).href)return {url:fixtureURL,shortCircuit:true};
  if(specifier.startsWith('@/'))return {url:target,shortCircuit:true};
  return next(specifier,context);
} });

test('real API handlers with cookies and isolated PostgreSQL', async (t)=>{
  process.env.LINE_CHANNEL_ACCESS_TOKEN='';process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY='';process.env.VAPID_PRIVATE_KEY='';
  const {database:db,files}=await import('./support/isolated-supabase.mjs');
  try {
    await db.exec('create role anon;create role authenticated;create role service_role;');
    for(const file of ['schema.sql','schema-hr.sql',...[1,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21].map(n=>`schema-phase${n}.sql`)])await db.exec(await fs.readFile(new URL('supabase/'+file,root),'utf8'));
    const password='test-password-only';const hash=await bcrypt.hash(password,4);
    for(const [id,role,manager] of [['ADMIN','admin',null],['HR','hr',null],['MANAGER','manager',null],['EMP','employee','MANAGER'],['OTHER','employee',null]]) {
      await db.query('insert into users(id,username,password,name,role,employee_id,manager_id) values($1,$1,$2,$1,$3,$1,$4)',[id,hash,role,manager]);
      await db.query('insert into employee_records(employee_id,salary) values($1,20000)',[id]);
    }
    await db.exec("update leave_types set days_per_year=10,deduct_balance=true where code='annual'");
    const login=await import('../app/api/auth/login/route.js');
    const auth=await import('../app/api/auth/me/route.js');
    const leave=await import('../app/api/me/leave/route.js');
    const review=await import('../app/api/hr/leave/[id]/approve/route.js');
    const generate=await import('../app/api/hr/payroll/generate/route.js');
    const pay=await import('../app/api/hr/payroll/confirm-pay/route.js');
    const permissions=await import('../app/api/hr/permissions/route.js');
    const team=await import('../app/api/me/team-leave/route.js');
    const cert=await import('../app/api/hr/document-requests/[id]/action/route.js');
    const ownCert=await import('../app/api/me/document-requests/route.js');
    const image=await import('../app/api/assets/image/route.js');
    const notify=await import('../app/api/hr/payroll/[id]/notify/route.js');
    const tax=await import('../app/api/me/tax-cert/route.js');
    const exports=await import('../app/api/hr/payroll/export/route.js');
    const request=(path,cookie,body)=>new Request('https://hr.test'+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const cookies={};
    await t.test('login returns HttpOnly cookie, no token in JSON, and uses current account state',async()=>{
      for(const id of ['ADMIN','HR','MANAGER','EMP','OTHER']) {
        const r=await login.POST(request('/api/auth/login',null,{username:id,password}));
        assert.equal(r.status,200,await r.clone().text());assert.match(r.headers.get('set-cookie'),/HttpOnly/i);
        cookies[id]=r.headers.get('set-cookie').split(';')[0];assert.equal((await r.json()).token,undefined);
      }
      assert.equal((await auth.GET(request('/api/auth/me',cookies.EMP))).status,200);
      await db.exec("update users set status='suspended' where id='EMP'");
      assert.equal((await auth.GET(request('/api/auth/me',cookies.EMP))).status,401);
      await db.exec("update users set status='active' where id='EMP'");
    });
    let leaveId;
    await t.test('employee submits half-day leave; unrelated manager cannot review it',async()=>{
      const r=await leave.POST(request('/api/me/leave',cookies.EMP,{leave_type:'annual',start_date:'2026-11-17',end_date:'2026-11-17',session:'half_morning',days:99}));
      assert.equal(r.status,200,await r.clone().text());const d=await r.json();leaveId=d.item.id;
      assert.equal(Number(d.item.days),0.5);assert.equal(d.item.session,'half_morning');
      const denied=await team.POST(request('/api/me/team-leave',cookies.OTHER,{id:leaveId,action:'approve'}));assert.equal(denied.status,403);
      const first=await team.POST(request('/api/me/team-leave',cookies.MANAGER,{id:leaveId,action:'approve'}));assert.equal(first.status,200,await first.clone().text());
      const done=await review.POST(request('/api/hr/leave/'+leaveId+'/approve',cookies.HR,{action:'approve'}),{params:Promise.resolve({id:String(leaveId)})});assert.equal(done.status,200,await done.clone().text());
      const again=await review.POST(request('/api/hr/leave/'+leaveId+'/approve',cookies.HR,{action:'approve'}),{params:Promise.resolve({id:String(leaveId)})});assert.equal(again.status,409);
    });
    await t.test('generate then regenerate then pay keeps reimbursement and payment state correct',async()=>{
      await db.exec("insert into expense_claims(employee_id,category,amount,claim_date,status) values('EMP','other',1000,'2026-11-17','approved')");
      for(let i=0;i<2;i++) {
        const r=await generate.POST(request('/api/hr/payroll/generate',cookies.HR,{period:'2026-11',overwrite:true}));assert.equal(r.status,200,await r.clone().text());
      }
      const slip=(await db.query("select * from payroll_slips where employee_id='EMP'")).rows[0];assert.equal(Number(slip.reimbursements),1000);assert.equal(Number(slip.bonus),0);
      const paid=await pay.POST(request('/api/hr/payroll/confirm-pay',cookies.HR,{slipId:slip.id}));assert.equal(paid.status,200,await paid.clone().text());
      const again=await pay.POST(request('/api/hr/payroll/confirm-pay',cookies.HR,{slipId:slip.id}));assert.equal((await again.json()).count,0);
      const sent=await notify.POST(request('/api/hr/payroll/'+slip.id+'/notify',cookies.HR,{}),{params:Promise.resolve({id:String(slip.id)})});assert.equal(sent.status,503);
      assert.equal((await db.query('select status from payroll_slips where id=$1',[slip.id])).rows[0].status,'paid');
    });
    await t.test('approved certificate uses frozen salary and files are restricted to the owner',async()=>{
      const file='document-assets/test.png';files.set(file,Buffer.from('fake image fixture'));
      const asset=(await db.query("insert into document_assets(asset_type,name,image_url) values('signature','Test signature',$1) returning id",[file])).rows[0];
      const created=await ownCert.POST(request('/api/me/document-requests',cookies.EMP,{document_type:'salary_certificate',purpose:'Test only'}));assert.equal(created.status,200,await created.clone().text());
      const id=(await created.json()).item.id;
      const r=await cert.POST(request('/api/hr/document-requests/'+id+'/action',cookies.HR,{action:'approve',signature_asset_id:asset.id}),{params:Promise.resolve({id:String(id)})});assert.equal(r.status,200,await r.clone().text());
      await db.exec("update employee_records set salary=99999 where employee_id='EMP'");
      const list=await ownCert.GET(request('/api/me/document-requests',cookies.EMP));assert.equal(Number((await list.json()).requests[0].employeeProfile.salary),20000);
      assert.equal((await image.GET(request('/api/assets/image?file='+encodeURIComponent(file),cookies.EMP))).status,200);
      assert.equal((await image.GET(request('/api/assets/image?file='+encodeURIComponent(file),cookies.OTHER))).status,403);
    });
    await t.test('tax certificate and tax CSV use paid taxable income and exclude draft slips',async()=>{
      const r=await tax.GET(request('/api/me/tax-cert?year=2569',cookies.EMP));assert.equal(r.status,200);
      const totals=await r.json();assert.equal(totals.totalIncome,20000);assert.equal(totals.months,1);
      for(const format of ['pnd1','sso']) {
        const report=await exports.GET(request('/api/hr/payroll/export?period=2026-11&format='+format,cookies.HR));assert.equal(report.status,200);
        const lines=(await report.text()).trim().split('\n');assert.equal(lines.length,2,'tax export must contain one paid employee and a header');
        assert.ok(lines[1].includes('EMP'));assert.ok(!lines[1].includes('21000'));
      }
      assert.equal((await exports.GET(request('/api/hr/payroll/export?period=2026-13&format=pnd1',cookies.HR))).status,400);
    });
    await t.test('HR cannot manage administrator-only permissions',async()=>{
      const result=await permissions.GET(request('/api/hr/permissions',cookies.HR));assert.equal(result.status,403);
      const before=(await db.query('select * from role_permissions order by role')).rows;
      const update=await permissions.PUT(new Request('https://hr.test/api/hr/permissions',{method:'PUT',headers:{cookie:cookies.HR,'Content-Type':'application/json'},body:JSON.stringify({role:'employee',menus:['__all__']})}));assert.equal(update.status,403);
      assert.deepEqual((await db.query('select * from role_permissions order by role')).rows,before);
      assert.equal((await permissions.GET(request('/api/hr/permissions',cookies.ADMIN))).status,200);
    });
  } finally { await db.close();hooks.deregister(); }
});
