(() => {
 const $ = id => document.getElementById(id);
 const cfg = window.FG_CONFIG || {};
 const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
   !cfg.SUPABASE_URL.startsWith("YOUR_") && !cfg.SUPABASE_ANON_KEY.startsWith("YOUR_");
 const db = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY) : null;
 let mods = [], session = null;
 $("year").textContent = new Date().getFullYear();
 const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const msg = (id,text,ok=false) => { $(id).textContent=text; $(id).className="message "+(ok?"success":""); };
 function showModal(){ $("adminModal").classList.remove("hidden"); }
 function hideModal(){ $("adminModal").classList.add("hidden"); }
 $("adminOpen").onclick=showModal; $("closeAdmin").onclick=hideModal;
 $("adminModal").addEventListener("click",e=>{if(e.target===$("adminModal"))hideModal();});
 function render(){
   const q=$("search").value.toLowerCase(), loader=$("loaderFilter").value;
   const list=mods.filter(m=>(!loader||m.loader===loader) && (m.name+" "+m.description+" "+m.category).toLowerCase().includes(q));
   $("modCount").textContent=mods.length+" mods";
   $("modGrid").innerHTML=list.length?list.map(m=>`<article class="mod-card"><div class="card-top"><span class="tag">${esc(m.loader)}</span><span class="tag">${esc(m.category||"Minecraft Mod")}</span></div><h3>${esc(m.name)}</h3><p>${esc(m.description)}</p><div class="meta"><span>Mod ${esc(m.version)}</span><span>Minecraft ${esc(m.minecraft_version)}</span></div><div class="card-actions"><a class="primary download" href="${esc(m.download_url)}" target="_blank" rel="noopener">Download ↗</a>${session?`<button class="danger delete" data-id="${esc(m.id)}">Delete</button>`:""}</div></article>`).join(""):'<div class="empty">No mods found yet. Check back soon.</div>';
   document.querySelectorAll(".delete").forEach(b=>b.onclick=()=>removeMod(b.dataset.id));
 }
 async function loadMods(){
   if(!db){$("modGrid").innerHTML='<div class="empty">Website setup is not finished. Add your Supabase URL and anon key in config.js, then follow SETUP.md.</div>';$("modCount").textContent="Setup needed";return;}
   const {data,error}=await db.from("mods").select("*").order("created_at",{ascending:false});
   if(error){$("modGrid").innerHTML='<div class="empty">Could not load mods. Check the Supabase setup and database policies.</div>';console.error(error);return;}
   mods=data||[];render();
 }
 $("search").oninput=render; $("loaderFilter").onchange=render; $("refreshMods").onclick=loadMods;
 $("loginForm").onsubmit=async e=>{
   e.preventDefault(); if(!db){msg("loginMessage","Finish Supabase setup first.");return;}
   const {data,error}=await db.auth.signInWithPassword({email:$("email").value,password:$("password").value});
   if(error){msg("loginMessage",error.message);return;}
   session=data.session; await checkAdmin();
 };
 async function checkAdmin(){
   if(!session){$("loginPanel").classList.remove("hidden");$("dashboard").classList.add("hidden");return;}
   const {data,error}=await db.from("admins").select("user_id").eq("user_id",session.user.id).maybeSingle();
   if(error||!data){await db.auth.signOut();session=null;msg("loginMessage","This account is not authorized as an admin.");return;}
   $("loginPanel").classList.add("hidden");$("dashboard").classList.remove("hidden");$("adminEmail").textContent=session.user.email;render();
 }
 $("logout").onclick=async()=>{await db.auth.signOut();session=null;$("dashboard").classList.add("hidden");$("loginPanel").classList.remove("hidden");render();};
 $("uploadForm").onsubmit=async e=>{
   e.preventDefault(); if(!session){msg("uploadMessage","Please sign in again.");return;}
   const file=$("modFile").files[0]; if(!file){msg("uploadMessage","Choose a .jar or .zip file.");return;}
   if(!/\.(jar|zip)$/i.test(file.name)){msg("uploadMessage","Only .jar and .zip files are allowed.");return;}
   $("uploadButton").disabled=true;msg("uploadMessage","Uploading…");
   try{
     const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
     const path=`${session.user.id}/${Date.now()}-${safeName}`;
     const {error:upErr}=await db.storage.from("mod-files").upload(path,file,{upsert:false,contentType:"application/octet-stream"});
     if(upErr)throw upErr;
     const {data:urlData}=db.storage.from("mod-files").getPublicUrl(path);
     const row={name:$("modName").value.trim(),description:$("description").value.trim(),version:$("version").value.trim(),minecraft_version:$("mcVersion").value.trim(),loader:$("loader").value,category:$("category").value.trim(),file_path:path,download_url:urlData.publicUrl,created_by:session.user.id};
     const {error:dbErr}=await db.from("mods").insert(row);
     if(dbErr){await db.storage.from("mod-files").remove([path]);throw dbErr;}
     msg("uploadMessage","Mod uploaded successfully.",true);$("uploadForm").reset();await loadMods();
   }catch(err){msg("uploadMessage",err.message||"Upload failed.");}
   finally{$("uploadButton").disabled=false;}
 };
 async function removeMod(id){
   if(!confirm("Delete this mod from the library?"))return;
   const mod=mods.find(m=>m.id===id);const {error}=await db.from("mods").delete().eq("id",id);
   if(error){alert(error.message);return;}
   if(mod?.file_path)await db.storage.from("mod-files").remove([mod.file_path]);
   await loadMods();
 }
 async function init(){
   if(db){const {data}=await db.auth.getSession();session=data.session;await checkAdmin();db.auth.onAuthStateChange((_event,s)=>{session=s;checkAdmin();});}
   await loadMods();
 }
 init();
})();