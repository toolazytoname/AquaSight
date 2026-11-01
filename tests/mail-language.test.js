import test from 'node:test';
import assert from 'node:assert/strict';
import { sendOtpEmail, RESEND_ENDPOINT } from '../src/mail.js';
test('verification mail delivers one code with Chinese and English instructions in HTML and plain text', async()=>{
 let sent;
 const result=await sendOtpEmail({to:'reader@example.com',code:'123456',env:{MAIL_DRIVER:'resend',MAIL_API_KEY:'test-key',MAIL_FROM:'Ponder <noreply@example.com>'},fetchImpl:async(url,init)=>{
  assert.equal(url,RESEND_ENDPOINT);sent=JSON.parse(init.body);return {ok:true,status:200};
 }});
 assert.equal(result.ok,true);
 assert.deepEqual(sent.to,['reader@example.com']);
 assert.match(sent.subject,/验证码.*Verification code/);
 for(const content of [sent.html,sent.text]){
  assert.equal(content.split('123456').length-1,1);
  assert.match(content,/10 分钟内有效/);
  assert.match(content,/expires in 10 minutes/);
  assert.match(content,/Do not share this code/);
 }
});
test('bilingual mail retains failed delivery status for the caller',async()=>{
 const result=await sendOtpEmail({to:'reader@example.com',code:'654321',env:{MAIL_DRIVER:'resend',MAIL_API_KEY:'test-key'},fetchImpl:async()=>({ok:false,status:503})});
 assert.equal(result.ok,false);assert.equal(result.error,'mail-http-503');
});
