const {crypto,cors,pp,finalSlot,no,findInvoice,details}=require("./_lib");
module.exports=async(req,res)=>{cors(res);if(req.method!=="GET")return res.status(405).json({ok:false,error:"method_not_allowed"});
const slot=finalSlot(req.query&&req.query.cap);if(!slot)return res.status(401).json({ok:false,error:"invalid_capability"});
const invNo=no("final",slot);try{let inv=await findInvoice(invNo);if(inv&&inv.id){if(String(inv.status||"").toUpperCase()==="DRAFT"){const sr=await pp("/v2/invoicing/invoices/"+encodeURIComponent(inv.id)+"/send",{method:"POST",headers:{"PayPal-Request-Id":"send-final-"+slot},body:JSON.stringify({send_to_recipient:true,send_to_invoicer:true})});if(!sr.ok&&sr.status!==422)return res.status(502).json({ok:false,error:"paypal_send_failed"});}const dr=await details(inv.id);const x=dr.body||inv;return res.status(200).json({ok:true,idempotent:true,slot,invoice_id:inv.id,status:x.status||inv.status||"UNKNOWN",invoice_number:invNo,reference:x.detail&&x.detail.reference||null,recipient_view_url:x.detail&&x.detail.metadata&&x.detail.metadata.recipient_view_url||null});}
const deal=String(req.query.deal_id||"").trim().replace(/[^A-Za-z0-9_-]/g,"").slice(0,60), email=String(req.query.email||"").trim(),client=String(req.query.client||"Client").trim().slice(0,120),project=String(req.query.project||"Project services").trim().slice(0,180),contract=Number(req.query.contract),deposit=Number(req.query.deposit),amount=Number(req.query.amount);
if(!deal||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return res.status(400).json({ok:false,error:"invalid_deal_or_email"});
// ---------------------------------------------------------------------------
// RECONSTRUCTED FROM HERE DOWN -- see auto-invoice.js for the identical note.
// The one deliberate difference from the deposit flow: the final invoice
// amount prefers an explicit `amount`, falling back to (contract - deposit)
// when both are given, since that's the only combination of the recovered
// query params (contract, deposit, amount) that makes business sense for a
// "final" balance-due invoice. Confirm against actual business rules before
// live use.
// ---------------------------------------------------------------------------
const remainder=(Number.isFinite(contract)&&Number.isFinite(deposit))?(contract-deposit):NaN;
const value=amount>0?amount:(remainder>0?remainder:contract);
if(!Number.isFinite(value)||value<=0)return res.status(400).json({ok:false,error:"invalid_amount"});
const cr=await pp("/v2/invoicing/invoices",{method:"POST",headers:{"PayPal-Request-Id":"create-final-"+slot},body:JSON.stringify({
  detail:{invoice_number:invNo,currency_code:"USD",reference:deal,note:"Final invoice for "+project},
  invoicer:{email_address:process.env.BUSINESS_EMAIL||undefined},
  primary_recipients:[{billing_info:{email_address:email,name:{given_name:client}}}],
  items:[{name:project.slice(0,60),quantity:"1",unit_amount:{currency_code:"USD",value:value.toFixed(2)}}]
})});
if(!cr.ok)return res.status(502).json({ok:false,error:"paypal_create_failed",status:cr.status});
const href=cr.body&&cr.body.href||"";
const id=cr.body&&cr.body.id||(href.split("/").pop()||"");
if(!id)return res.status(502).json({ok:false,error:"paypal_create_missing_id"});
const sr=await pp("/v2/invoicing/invoices/"+encodeURIComponent(id)+"/send",{method:"POST",headers:{"PayPal-Request-Id":"send-final-"+slot},body:JSON.stringify({send_to_recipient:true,send_to_invoicer:true})});
if(!sr.ok&&sr.status!==422)return res.status(502).json({ok:false,error:"paypal_send_failed"});
const dr=await details(id);const x=dr.body||{};
return res.status(200).json({ok:true,idempotent:false,slot,invoice_id:id,status:x.status||"SENT",invoice_number:invNo,reference:deal,recipient_view_url:x.detail&&x.detail.metadata&&x.detail.metadata.recipient_view_url||null});
}catch(e){return res.status(500).json({ok:false,error:String(e&&e.message||"create_failed")});}
};
