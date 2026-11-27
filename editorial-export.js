(function(){
'use strict';
function b64utf8(s){var bytes=new TextEncoder().encode(s),out='';for(var i=0;i<bytes.length;i+=8192)out+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));return btoa(out);}
function fold(s){return (s.match(/.{1,76}/g)||[]).join('\r\n');}
function wrap(ctx,str,max){var words=String(str||'').split(/\s+/),lines=[],line='';words.forEach(function(w){if(ctx.measureText(line?line+' '+w:w).width>max&&line){lines.push(line);line=w;}else line+=(line?' ':'')+w;});if(line)lines.push(line);return lines;}
function tile(w,h,draw){var c=document.createElement('canvas');c.width=w;c.height=h;var x=c.getContext('2d');draw(x,w,h);return c.toDataURL('image/png').split(',')[1];}
function txt(x,s,px,weight,color,left,top,width,maxLines,lineHeight){x.font=weight+' '+px+'px Arial';x.fillStyle=color;var lines=wrap(x,s,width);lines.slice(0,maxLines||99).forEach(function(line,i){x.fillText(line,left,top+i*(lineHeight||px*1.25));});}
function panel(e,helpers){
 var p=String(e.platform||'').toLowerCase();
 var color={shopee:'#ee4d2d',lazada:'#3421c9',tiktok:'#101827'}[p]||'#334155';
 var measure=document.createElement('canvas').getContext('2d');
 function linesFor(value,font){
   measure.font=font;
   return String(value||'').split(/\r?\n/).flatMap(function(paragraph){
     if(!paragraph.trim())return [''];
     var words=paragraph.trim().split(/\s+/), lines=[], line='';
     words.forEach(function(word){
       var next=line?line+' '+word:word;
       if(measure.measureText(next).width<=280){line=next;return;}
       if(line)lines.push(line);
       line='';
       for(var character of word){
         if(measure.measureText(line+character).width>280){
           lines.push(line);
           line='';
         }
         line+=character;
       }
     });
     if(line)lines.push(line);
     return lines;
   });
 }
 var title=linesFor(e.title,'bold 14px Arial');
 var summary=linesFor(helpers.briefSummary?helpers.briefSummary(e):helpers.text(e),'normal 10px Arial');
 var summaryTop=Math.max(121,54+title.length*21+5);
 var buttonTop=Math.max(162,summaryTop+summary.length*13+2);
 var markets=sources(e,helpers);
 return tile(310,buttonTop+(markets.length>1?8:28),function(x,w,h){
   var gradient=x.createLinearGradient(0,0,w,h);
   gradient.addColorStop(0,color);
   gradient.addColorStop(1,p==='shopee'?'#ff9a51':p==='lazada'?'#8253f2':p==='tiktok'?'#29324b':'#4e6584');
   x.fillStyle=gradient;
   x.fillRect(0,0,w,h);
   x.fillStyle='rgba(255,255,255,.10)';
   x.beginPath();x.arc(280,85,64,0,Math.PI*2);x.fill();
   x.beginPath();x.arc(295,158,37,0,Math.PI*2);x.fill();
   txt(x,(e.platform||'').toUpperCase()+' / '+helpers.regions(e).join(', '),11,'bold','#fff',15,23,280,1);
   x.fillStyle='#fff';
   x.font='bold 14px Arial';
   title.forEach(function(line,i){x.fillText(line,15,54+i*21);});
   x.font='normal 10px Arial';
   summary.forEach(function(line,i){x.fillText(line,15,summaryTop+i*13);});
   if(markets.length>1)return;
   x.fillRect(15,buttonTop,158,21);
   txt(x,markets[0].url?'READ OFFICIAL UPDATE >':'MARKETPLACE NOTICE',9,'bold',color,23,buttonTop+14,145,1);
 });
}
function rowImage(e,helpers,index){return tile(632,77,function(x,w,h){x.fillStyle='#ffffff';x.fillRect(0,0,w,h);x.fillStyle='#20cdd8';x.fillRect(0,0,5,h);txt(x,String(index+1).padStart(2,'0'),15,'bold','#0e91a5',16,29,40,1);txt(x,(e.platform||'').toUpperCase()+' / '+helpers.regions(e).join(', '),11,'bold','#66768c',56,21,540,1);txt(x,e.title,16,'bold','#14263f',56,49,560,1);});}
function heading(title,sub){return tile(632,78,function(x,w,h){x.fillStyle='#102039';x.fillRect(0,0,w,h);txt(x,title,19,'bold','#ffffff',20,34,590,1);txt(x,sub,12,'normal','#aebfd1',20,58,590,1);});}
function header(period,count,platforms){return tile(632,136,function(x,w,h){x.fillStyle='#102039';x.fillRect(0,0,w,h);txt(x,'MERCHANDISING INTELLIGENCE',11,'bold','#23d6e3',24,25,580,1);txt(x,'THE MERCHANDISING',25,'bold','#ffffff',24,68,580,1);txt(x,'EDIT.',29,'bold','#23d6e3',24,103,570,1);txt(x,period+'  •  '+platforms+' PLATFORMS  •  '+count+' UPDATES',11,'normal','#ffffff',24,126,580,1);});}
function footer(period){return tile(632,78,function(x,w,h){x.fillStyle='#102039';x.fillRect(0,0,w,h);txt(x,'THE MERCHANDISING EDIT  /  '+period,14,'bold','#ffffff',20,31,590,1);txt(x,'Marketplace updates at a glance  •  End of digest',11,'normal','#9ed8e4',20,55,590,1);});}
function safeUrl(value){
 var url=String(value||'').trim();
 if(!/^https?:\/\/[^\s]+$/i.test(url))return '';
 try{return new URL(url).hostname.includes('.')?url:'';}catch(error){return '';}
}
function sources(entry,helpers){
 var regions=helpers.regions(entry);
 if(regions.length<2)return [{region:regions[0],url:safeUrl(helpers.link(entry))}];
 var links=helpers.links?helpers.links(entry):{};
 return regions.map(function(region){return {region:region,url:safeUrl(links[region])};});
}
function escapeHtml(value){
 return String(value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
}
function regionLinks(entry,helpers,color,preview){
 var markets=sources(entry,helpers);
 if(markets.length<2)return '';
 return '<div style="padding:8px 12px;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:'+color+'">'+markets.map(function(market){
   var label=escapeHtml(market.region);
   return market.url
     ? '<a href="'+escapeHtml(market.url)+'"'+(preview?' target="_blank" rel="noopener noreferrer"':'')+' style="color:'+color+';font-weight:bold;text-decoration:underline">'+label+'</a>'
     : '<span>'+label+' (link unavailable)</span>';
 }).join(' &nbsp;·&nbsp; ')+'</div>';
}
window.editorialSources={forEntry:sources,regionLinks:regionLinks};
window.exportEditorialEml=async function(featured,linked,notices,helpers,period,textNotices){
 var parts=[],imgs=[],n=0;
 function addImage(data,width,href,links){var cid='edit'+(++n)+'@newsletter';imgs.push({cid:cid,data:data});return '<td style="padding:4px;vertical-align:top"'+(width?' width="'+width+'"':'')+'>'+(href?'<a href="'+href.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'">':'')+'<img src="cid:'+cid+'" width="'+(width||632)+'" style="display:block;width:'+(width||632)+'px;height:auto;border:0;max-width:100%" alt="Newsletter panel">'+(href?'</a>':'')+(links||'')+'</td>';}
 function entryImage(data,width,entry){
   var markets=sources(entry,helpers);
   return addImage(data,width,markets.length===1?markets[0].url:'',regionLinks(entry,helpers,'#14263f',false));
 }
 function line(data){parts.push('<tr>'+addImage(data,632)+'</tr>');}
 textNotices=textNotices||[];line(header(period,featured.length+linked.length+notices.length+textNotices.length,new Set(featured.concat(linked,notices,textNotices).map(function(e){return e.platform;})).size));
 line(heading('THE BRIEF','Featured marketplace updates'));
 for(var i=0;i<featured.length;i+=2){
   var cells=featured.slice(i,i+2).map(function(entry){return entryImage(panel(entry,helpers),310,entry);});
   parts.push('<tr>'+cells.join('')+'</tr>');
 }
 line(heading('NEWS WIRE',linked.length+' linked updates'));
 linked.forEach(function(e,i){parts.push('<tr>'+entryImage(rowImage(e,helpers,i),632,e)+'</tr>');});
 var additional=notices.concat(textNotices),order={lazada:0,shopee:1,tiktok:2};additional.sort(function(a,b){var pa=String(a.platform||'').toLowerCase(),pb=String(b.platform||'').toLowerCase();var d=(order[pa]===undefined?99:order[pa])-(order[pb]===undefined?99:order[pb]);return d||pa.localeCompare(pb)||helpers.regions(a).join(', ').localeCompare(helpers.regions(b).join(', '));});
 if(additional.length){line(heading('ALSO WORTH NOTING',additional.length+' additional updates'));additional.forEach(function(e,i){parts.push('<tr>'+entryImage(rowImage(e,helpers,i),632,e)+'</tr>');});line(tile(632,48,function(x,w,h){x.fillStyle='#f2f6fa';x.fillRect(0,0,w,h);txt(x,'Full details and supporting visuals are available in the attached PDF.',13,'normal','#52667b',20,29,590,1);}));}
 line(footer(period));
 var html='<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#edf2f7"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="640" style="width:640px;max-width:100%;margin:0 auto;background:#edf2f7">'+parts.join('')+'</table></body></html>';
 var boundary='edit_'+Date.now(),eml='MIME-Version: 1.0\r\nSubject: The Merchandising Edit - '+period.replace(/[\r\n]/g,' ')+'\r\nContent-Type: multipart/related; boundary="'+boundary+'"; type="text/html"\r\n\r\n--'+boundary+'\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+fold(b64utf8(html))+'\r\n';
 imgs.forEach(function(img){eml+='--'+boundary+'\r\nContent-Type: image/'+(img.type||'png')+'\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <'+img.cid+'>\r\nContent-Disposition: inline\r\n\r\n'+fold(img.data)+'\r\n';});eml+='--'+boundary+'--\r\n';
 var url=URL.createObjectURL(new Blob([eml],{type:'message/rfc822'}));var a=document.createElement('a');a.href=url;a.download='The_Merchandising_Edit_Outlook.eml';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},5000);
};
})();