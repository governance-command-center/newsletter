(function(){'use strict';
const BASE='https://pzvpcydroidhycnksrnt.supabase.co/functions/v1/hub-auth';
const KEY='sb_publishable_Z0QsdZFdXpTY3jfTTn6JlA_tEYkkmpp';
const ORDER=['dewo','vhino','phuong','small hong','irish','jia jun','froy','gab'];
let members=[],rows=[],me='',role='',selected='',editing=false,dirty=false,week=weekOf(new Date()),busy=false;
const $=id=>document.getElementById(id);
function weekOf(d){const x=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));x.setUTCDate(x.getUTCDate()-(x.getUTCDay()+6)%7);return x.toISOString().slice(0,10)}
function date(iso){return new Date(iso+'T12:00:00Z')}
function moveWeek(n){const d=date(week);d.setUTCDate(d.getUTCDate()+7*n);week=d.toISOString().slice(0,10);load()}
function nice(iso){return date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}
function label(m){if(m.username.toLowerCase().replace(/[._-]/g,' ')==='newsletter governance')return 'Vhino';return m.username.replace(/[._-]/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
function session(){try{return JSON.parse(sessionStorage.getItem('merchHub.secureSession.v1')||'null')}catch{return null}}
async function api(payload){const s=session();if(!s?.access_token)throw Error('Please sign in through the Merchandising Hub first.');const r=await fetch(BASE,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify({action:'focus',...payload})});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'Request failed');return data}
function alertMsg(t){$('toast').textContent=t;$('toast').style.display='block';setTimeout(()=>$('toast').style.display='none',4200)}
function sorted(a,b){const ia=ORDER.indexOf(a.username.toLowerCase().replace(/[_-]/g,' ')),ib=ORDER.indexOf(b.username.toLowerCase().replace(/[_-]/g,' '));return (ia<0?100:ia)-(ib<0?100:ib)||a.username.localeCompare(b.username)}
function getRow(){return rows.find(r=>r.user_id===selected)}
function canEdit(){return selected===me||role==='admin'}
function safe(html){const t=document.createElement('template');t.innerHTML=html;const allowed=new Set(['B','STRONG','I','EM','U','MARK','UL','OL','LI','P','DIV','BR','SPAN','FONT','H2','H3','HR']);function clean(root){[...root.children].forEach(el=>{if(!allowed.has(el.tagName)){const frag=document.createDocumentFragment();while(el.firstChild)frag.appendChild(el.firstChild);el.replaceWith(frag);clean(root);return}for(const a of [...el.attributes]){if(a.name==='style'){const v=a.value;el.removeAttribute('style');const color=v.match(/background-color:\s*(#[0-9a-f]{3,6}|rgb\([0-9, ]+\))/i);if(color)el.style.backgroundColor=color[1]}else if(!(el.tagName==='FONT'&&a.name==='size'))el.removeAttribute(a.name)}clean(el)})}clean(t.content);return t.innerHTML}
function content(){const row=getRow();return (row?.content||[]).join('')}
function topicCount(html){const t=document.createElement('div');t.innerHTML=html;return t.querySelectorAll('hr').length+(t.textContent.trim()?1:0)}
function presentationHtml(html){
 const root=document.createElement('div');root.innerHTML=html;
 const hasSeparators=!!root.querySelector('hr');
 const result=document.createElement('div');let section=null,n=0;
 function newSection(){
  section=document.createElement('section');section.className='focus-topic';
  const tag=document.createElement('span');tag.className='focus-topic-label';
  tag.textContent=String(++n).padStart(2,'0')+' / DISCUSSION TOPIC';
  section.appendChild(tag);result.appendChild(section);
 }
 [...root.childNodes].forEach(node=>{
  if(node.nodeType===1&&node.nodeName==='HR'){section=null;return}
  if(!section && (node.textContent||'').trim())newSection();
  if(!hasSeparators&&node.nodeType===1&&node.matches('h2,h3')&&section&&section.children.length>1)newSection();
  if(section)section.appendChild(node);else if(node.textContent.trim())result.appendChild(node);
 });
 if(!n)return root.innerHTML;
 // Render legacy typed asterisks as bullets without rewriting the saved content.
 result.querySelectorAll('p,div').forEach(el=>{
  if(el.children.length||!/^\\s*\\*\\s*\\S/.test(el.textContent))return;
  el.textContent=el.textContent.replace(/^\\s*\\*\\s*/,'');
  el.classList.add('focus-legacy-bullet');
 });
 return result.innerHTML;
}
function presentMeta(html){
 const t=document.createElement('div');t.innerHTML=html;
 const text=t.textContent.trim();
 if(!text)return 'No discussion entries yet';
 const n=topicCount(html);
 return n+' discussion '+(n===1?'entry':'entries');
}
function show(){const m=members.find(x=>x.id===selected);if(!m)return;
$('people').innerHTML='';members.forEach(x=>{const b=document.createElement('button');b.textContent=label(x);b.className=(x.id===selected?'active ':'')+(rows.some(r=>r.user_id===x.id&&r.content?.some(Boolean))?'has':'');b.onclick=()=>{if(editing&&dirty&&!confirm('Discard unsaved changes?'))return;editing=false;dirty=false;selected=x.id;show()};$('people').appendChild(b)});
$('pageNo').textContent=String(members.findIndex(x=>x.id===selected)+1).padStart(2,'0');
$('personName').textContent=label(m);
const heading=$('personName');
const header=heading.closest('.paperhead');
let wrap=header.querySelector('.person-heading');
if(!wrap){
 wrap=document.createElement('div');wrap.className='person-heading';
 heading.before(wrap);
 const avatar=document.createElement('span');avatar.className='person-initial';avatar.setAttribute('aria-hidden','true');
 wrap.append(avatar,heading);
}
wrap.querySelector('.person-initial').textContent=label(m).trim().charAt(0).toUpperCase();
$('personSub').textContent=selected===me?'Your discussion page':'Member discussion page';
let meta=header.querySelector('.focus-meta');
if(!meta){meta=document.createElement('div');meta.className='focus-meta';$('personSub').after(meta)}
meta.textContent=presentMeta(safe(content()));
$('counter').textContent=(members.findIndex(x=>x.id===selected)+1)+' / '+members.length;
$('previous').disabled=members[0].id===selected;$('next').disabled=members[members.length-1].id===selected;
$('editBtn').hidden=!canEdit()||document.body.classList.contains('presentation');$('editBtn').textContent=editing?'Cancel editing':selected===me?'Edit my topics':'Admin override · Edit';
$('viewer').hidden=editing;$('editor').hidden=!editing;
if(!editing){const h=safe(content());$('viewer').innerHTML=h?presentationHtml(h):'<div class="focus-empty"><span class="focus-empty-icon" aria-hidden="true">✎</span><span>No topics yet. Add yours before the meeting.</span></div>';$('viewer').classList.remove('focus-enter');void $('viewer').offsetWidth;$('viewer').classList.add('focus-enter')}
else {$('editable').innerHTML=safe(content());$('saveBtn').disabled=false}
}
async function load(){if(editing&&dirty&&!confirm('Discard unsaved changes?'))return;editing=false;dirty=false;$('weekLabel').textContent=nice(week)+' – '+nice(new Date(date(week).getTime()+6*86400000).toISOString().slice(0,10));$('saveStatus').textContent='Loading…';try{const data=await api({operation:'read',week});members=data.members.sort(sorted);rows=data.rows;me=data.me;role=data.role;if(!members.some(m=>m.id===selected))selected=members.find(m=>m.id===me)?.id||members[0]?.id||'';$('summary').textContent=members.length+' presenters · '+rows.filter(r=>r.content?.some(Boolean)).length+' with topics';$('saveStatus').textContent='Shared workspace';show()}catch(e){$('saveStatus').textContent=e.message;alertMsg(e.message)}}
$('prevWeek').onclick=()=>moveWeek(-1);$('nextWeek').onclick=()=>moveWeek(1);
$('previous').onclick=()=>switchPerson(-1);$('next').onclick=()=>switchPerson(1);
function switchPerson(n){if(editing&&dirty&&!confirm('Discard unsaved changes?'))return;editing=false;dirty=false;const i=members.findIndex(m=>m.id===selected)+n;if(members[i]){selected=members[i].id;show()}}
$('editBtn').onclick=()=>{if(editing&&dirty&&!confirm('Discard unsaved changes?'))return;editing=!editing;dirty=false;show()};
$('editable').addEventListener('input',()=>{dirty=true;$('saveStatus').textContent='Unsaved changes'});
$('toolbar').addEventListener('mousedown',e=>{if(e.target.closest('button'))e.preventDefault()});
$('toolbar').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;$('editable').focus();if(b.dataset.cmd==='addEntry'){document.execCommand('insertHTML',false,'<hr><p><br></p>')}else if(b.dataset.cmd==='removeFormat'){document.execCommand('removeFormat',false,null)}else if(b.dataset.cmd==='hiliteColor'){document.execCommand('hiliteColor',false,b.dataset.value||'#fff0aa')}else if(b.dataset.cmd==='insertUnorderedList'||b.dataset.cmd==='insertOrderedList'){
const sel=window.getSelection(),range=sel&&sel.rangeCount?sel.getRangeAt(0):null;
const lines=sel?sel.toString().split(/\r?\n/).map(x=>x.trim()).filter(Boolean):[];
if(range&&!range.collapsed&&lines.length>1){
 const tag=b.dataset.cmd==='insertOrderedList'?'ol':'ul';
 const escapeText=x=>x.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 document.execCommand('insertHTML',false,'<'+tag+'>'+lines.map(x=>'<li>'+escapeText(x)+'</li>').join('')+'</'+tag+'>');
}else document.execCommand(b.dataset.cmd,false,null);
}else{document.execCommand(b.dataset.cmd,false,b.dataset.value||null)}dirty=true;$('saveStatus').textContent='Unsaved changes'});
$('saveBtn').onclick=async()=>{if(busy)return;busy=true;$('saveBtn').disabled=true;$('saveStatus').textContent='Saving…';try{const existing=getRow();const cleaned=safe($('editable').innerHTML);const result=await api({operation:'save',week,user_id:selected,admin_override:selected!==me,expected_updated_at:existing?.updated_at||null,content:cleaned.trim()?[cleaned]:[]});rows=rows.filter(r=>r.user_id!==selected);rows.push({user_id:selected,content:cleaned.trim()?[cleaned]:[],updated_at:result.updated_at});editing=false;dirty=false;$('saveStatus').textContent='Saved';$('summary').textContent=members.length+' presenters · '+rows.filter(r=>r.content?.some(Boolean)).length+' with topics';show();alertMsg('Weekly topics saved')}catch(e){$('saveStatus').textContent='Save failed';alertMsg(e.message)}finally{busy=false;$('saveBtn').disabled=false}};
$('present').onclick=()=>{if(editing&&dirty&&!confirm('Discard unsaved changes?'))return;editing=false;dirty=false;document.body.classList.toggle('presentation');$('present').textContent=document.body.classList.contains('presentation')?'Exit presentation':'Present ↗';show()};
document.addEventListener('keydown',e=>{if(document.body.classList.contains('presentation')&&e.key==='Escape'){$('present').click()}else if(document.body.classList.contains('presentation')&&e.key==='ArrowRight')switchPerson(1);else if(document.body.classList.contains('presentation')&&e.key==='ArrowLeft')switchPerson(-1)});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
load();
})();