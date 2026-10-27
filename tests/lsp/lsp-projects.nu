use ../support.nu temporary-directory
use std/assert

def main [] {
  let tool = ($env.FILE_PWD | path dirname | path dirname)
  let temp = (temporary-directory "lsp-projects")
  try {
    let bridge = r####'
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {join,dirname} from "node:path";
import {pathToFileURL} from "node:url";
import {spawn} from "node:child_process";
const [tool,temp]=process.argv.slice(1),root=fs.realpathSync(temp),repo=join(root,"repo");
const uri=path=>pathToFileURL(path).href, dir=path=>uri(path)+"/";
const write=(path,text)=>{fs.mkdirSync(dirname(path),{recursive:true});fs.writeFileSync(path,text)};
const contract='extern fn render() [desc = [Render]]';
const config='[project]\n[preset.enabled]\ncore=["core"]\nedge=["edge"]\n[preset.empty]\ncore=["core"]\nedge=[]';
const a=join(repo,"a"),b=join(repo,"b"),nested=join(a,"tools/nested"),outside=join(root,"outside");
for(const project of [a,b,nested,outside]){
 write(join(project,"config.toml"),config);
 write(join(project,"core/config.toml"),'[crate]\nid="same_identity"');
 write(join(project,"core/lib.afl"),contract);
 write(join(project,"edge/config.toml"),'[dep]\ncore="../core"');
 write(join(project,"edge/lib.afl"),'impl dep::core::lib::render\nfn render() {}');
}
write(join(repo,"legacy/config.toml"),'[preset.a]\ncore=[]\nedge=[]');
const timeout=setTimeout(()=>{throw Error("Multi-project protocol test timed out")},25000);
const start=async(folders,options={})=>{
 const child=spawn(process.execPath,[join(tool,"packages/lsp/bin/afl-lsp.mjs"),"--node-ipc"],{stdio:["pipe","pipe","pipe","ipc"]});
 let serial=0,stderr="";const pending=new Map(),diagnostics=new Map();
 child.stderr.on("data",data=>stderr+=data);
 const send=message=>child.send({jsonrpc:"2.0",...message});
 child.on("message",message=>{
  if(message.method&&message.id!==undefined)send({id:message.id,result:null});
  else if(message.id!==undefined){const entry=pending.get(message.id);pending.delete(message.id);message.error?entry.reject(Error(JSON.stringify(message.error))):entry.resolve(message.result)}
  else if(message.method==="textDocument/publishDiagnostics")diagnostics.set(message.params.uri,message.params.diagnostics);
 });
 const request=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});send({id,method,params})});
 const notify=(method,params={})=>send({method,params});
 await request("initialize",{processId:process.pid,workspaceFolders:folders.map(path=>({uri:uri(path),name:path})),initializationOptions:options,
  capabilities:{workspace:{workspaceFolders:true,didChangeWatchedFiles:{dynamicRegistration:true,relativePatternSupport:true}}}});
 notify("initialized");
 const query=(method,path,line=0,character=10)=>request("textDocument/"+method,{textDocument:{uri:uri(path)},position:{line,character}});
 const focus=path=>request("afl/projectContext",path?{documentUri:uri(path)}:{});
 const open=(path,languageId="afl",text=fs.readFileSync(path,"utf8"))=>notify("textDocument/didOpen",{textDocument:{uri:uri(path),languageId,version:1,text}});
 const change=(path,text)=>notify("textDocument/didChange",{textDocument:{uri:uri(path),version:2},contentChanges:[{text}]});
 const event=(path,type=2)=>notify("workspace/didChangeWatchedFiles",{changes:[{uri:uri(path),type}]});
 const select=(project,preset)=>request("workspace/executeCommand",{command:preset?"afl.checkPreset":"afl.checkProject",arguments:[uri(project),...(preset?[preset]:[])]});
 const codes=path=>(diagnostics.get(uri(path))??[]).map(item=>item.code);
 const stop=async()=>{await request("shutdown");notify("exit");await new Promise(resolve=>child.on("exit",resolve));assert.equal(stderr,"")};
 return{child,request,notify,query,focus,open,change,event,select,codes,stop,diagnostics};
};
let server;
try{
 server=await start([repo]);
 let state=await server.focus();assert.equal(state.projects.length,3);assert.equal(state.activeProjectUri,undefined);
 const af=join(a,"core/lib.afl"),bf=join(b,"core/lib.afl"),nf=join(nested,"core/lib.afl");
 server.open(af);server.open(bf);server.open(nf);
 state=await server.focus(af);assert.equal(state.activeProjectUri,dir(a));
 await server.select(a,"enabled");await server.select(b,"empty");
 assert.deepEqual(server.codes(af),[]);assert(server.codes(bf).includes("AFL4101"));
 await server.select(join(repo,"legacy"),"a");assert(server.codes(join(repo,"legacy/config.toml")).includes("AFL4003"));
 assert(!server.codes(join(a,"core/config.toml")).includes("AFL3001"),"same crate IDs in independent projects must not conflict");
 let targets=await server.query("implementation",af);assert.equal(targets[0].uri,uri(join(a,"edge/lib.afl")));
 assert.deepEqual(await server.query("implementation",bf),[]);
 state=await server.focus(nf);assert.equal(state.activeProjectUri,dir(nested));
 await server.select(a);assert(server.codes(bf).includes("AFL4101"),"clearing A must not clear B");
 // Keep the known project boundary while TOML is temporarily incomplete.
 const ac=join(a,"config.toml");server.open(ac,"toml");server.change(ac,"[project]\n[preset.");
 state=await server.focus(af);assert.equal(state.activeProjectUri,dir(a));assert(server.codes(ac).includes("AFL4001"));
 assert(server.codes(bf).includes("AFL4101"),"invalid A must not disable B");
 server.change(ac,config);await server.select(a,"enabled");assert.deepEqual(server.codes(ac),[]);
 await server.select(a);
 const nc=join(nested,"config.toml");server.open(nc,"toml");server.change(nc,"[project]\n[preset.");
 server.change(af,contract+"\nfn extra() {}");await server.focus(af);
 assert(!server.codes(join(a,"core/config.toml")).includes("AFL3001"),"malformed nested roots must remain excluded from their parent scan");
 server.change(nc,config);server.change(af,contract);await server.select(a,"enabled");
 // Add a project via an unsaved config, then remove its marker with another valid edit.
 const fresh=join(repo,"new/config.toml");server.open(fresh,"toml","[project]");state=await server.focus(fresh);assert.equal(state.activeProjectUri,dir(dirname(fresh)));
 server.change(fresh,"[dep]");state=await server.focus(fresh);assert(!state.projects.some(item=>item.uri===dir(dirname(fresh))));
 // A saved root outside the workspace is an explicit discovery boundary.
 await server.select(outside,"enabled");state=await server.focus(join(outside,"core/lib.afl"));assert.equal(state.activeProjectUri,dir(outside));
 // Shared external dependencies retain the selected consumer; diagnostics identify both contexts.
 const shared=join(root,"shared");write(join(shared,"config.toml"),'[dep]');write(join(shared,"lib.afl"),'fn value() { missing() }');
 for(const project of [a,b])write(join(project,"core/config.toml"),'[crate]\nid="same_identity"\n[dep]\nshared="'+shared+'"');
 server.event(join(a,"core/config.toml"));server.event(join(b,"core/config.toml"));
 await server.focus(af);server.open(join(shared,"lib.afl"));state=await server.focus(join(shared,"lib.afl"));assert.equal(state.activeProjectUri,dir(a));
 const sharedDiagnostics=server.diagnostics.get(uri(join(shared,"lib.afl")))??[];
 assert(sharedDiagnostics.some(item=>item.data.projectUri===dir(a)&&item.message.includes(a)));
 assert(sharedDiagnostics.some(item=>item.data.projectUri===dir(b)&&item.message.includes(b)));
 await server.stop();server=undefined;
 // Restore both selections before the first analysis, with no source document open.
 server=await start([repo],{projects:[{projectUri:uri(a),preset:"enabled"},{projectUri:uri(b),preset:"empty"}],activeDocumentUri:uri(af)});
 state=await server.focus(af);assert.equal(state.activeProjectUri,dir(a));assert(!server.codes(af).includes("AFL4101"));assert(server.codes(bf).includes("AFL4101"));
 await server.stop();server=undefined;
 server=await start([join(a,"core")]);state=await server.focus(af);assert.deepEqual(state.projects,[],"workspace subdirectories must not discover ancestor roots");
 const rejected=await server.request("workspace/executeCommand",{command:"afl.listPresets",arguments:[uri(join(repo,"legacy"))]});
 assert(rejected.diagnostics.some(item=>item.code==="AFL4003"));
 await server.stop();server=undefined;
 // A discarded asynchronous refresh must not mutate any published cached service.
 const {build}=await import(uri(join(tool,"node_modules/esbuild/lib/main.js")));
 const bundle=join(root,"projects.mjs");
 await build({entryPoints:[join(tool,"packages/lsp/src/projects.ts")],bundle:true,platform:"node",format:"esm",outfile:bundle,logLevel:"silent"});
 const {EditorProjects}=await import(uri(bundle));
 const ca=join(root,"race/a"),cb=join(root,"race/b");
 for(const p of [ca,cb]){write(join(p,"config.toml"),"[project]");write(join(p,"main.afl"),"fn original() {}")}
 const manager=new EditorProjects();await manager.setFolders([uri(join(root,"race"))]);
 await manager.select({projectUri:uri(ca)},false);await manager.select({projectUri:uri(cb)},false);
 const original={uri:uri(join(ca,"main.afl")),languageId:"afl",text:"fn original() {}"};
 assert(await manager.refresh([uri(join(root,"race"))],[original],()=>true));
 const published=manager.context(original.uri).service,read=fsp.readFile;
 let entered,release;const loading=new Promise(resolve=>entered=resolve),paused=new Promise(resolve=>release=resolve);
 let pause=true,current=true;
 fsp.readFile=async function(path,...args){if(String(path)===join(cb,"main.afl")&&pause){entered();await paused}return read.call(this,path,...args)};
 syncBuiltinESMExports();
 try{
  const configEdit={uri:uri(join(cb,"config.toml")),languageId:"toml",text:"[project]\n# edited"};
  const inflight=manager.refresh([uri(join(root,"race"))],[{...original,text:"fn superseded() {}"},configEdit],()=>current);
  await loading;assert.equal(published.getSource(original.uri).text,original.text,"read-in-progress must not change published sources");
  current=false;pause=false;release();assert.equal(await inflight,false);
  assert(await manager.refresh([uri(join(root,"race"))],[original,configEdit],()=>true));
  assert.equal(manager.context(original.uri).service.getSource(original.uri).text,original.text);
 }finally{pause=false;release();fsp.readFile=read;syncBuiltinESMExports()}
 console.log("Multi-project LSP: isolation, nested roots, overlays, shared dependencies, boundaries and restored selections passed.");
}finally{clearTimeout(timeout);server?.child.kill()}
'####
    let result = (^node --input-type=module -e $bridge $tool $temp | complete)
    assert equal $result.exit_code 0 $result.stderr
    print ($result.stdout | str trim)
  } catch {|err| rm -rf $temp; error make $err }
  rm -rf $temp
}
