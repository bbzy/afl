use std/assert

def main [] {
  let root = ($env.FILE_PWD | path dirname | path dirname)
  let bridge = r###'
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const assert = require("node:assert/strict"), {pathToFileURL,fileURLToPath} = require("node:url");
const root=process.argv[1], esbuild=require(path.join(root,"node_modules/esbuild"));
const commands=new Map(),statuses=[],memory=new Map(),errors=[],calls=[];
const a=pathToFileURL(path.join(root,"demo/edge/")).href,b=pathToFileURL(path.join(root,"demo/implementations/")).href;
const uri=text=>({scheme:new URL(text).protocol.slice(0,-1),fsPath:fileURLToPath(text),toString:()=>text});
let picks=[],dialogs=[],items,saveFailure=false,apply=async()=>{},located=a,locate=async()=>state(located),listener,canonical=value=>value.projectUri;
const roots=[{uri:a,diagnostics:[]},{uri:b,diagnostics:[]}];
const state=activeProjectUri=>({projects:roots,...(activeProjectUri?{activeProjectUri}:{})});
const api={
 Uri:{parse:uri},StatusBarAlignment:{Left:1},
 window:{
  activeTextEditor:undefined,
  onDidChangeActiveTextEditor:callback=>{listener=callback;return{dispose(){listener=undefined;}}},
  createStatusBarItem:()=>{const s={show(){this.visible=true},dispose(){this.disposed=true}};statuses.push(s);return s},
  showQuickPick:async values=>{items=values;const pick=picks.shift();return pick===undefined?undefined:values.find(item=>item.label===pick||item.preset===pick)},
  showOpenDialog:async()=>dialogs.shift(),
 },
 commands:{registerCommand:(name,callback)=>{commands.set(name,callback);return{dispose(){commands.delete(name)}}}},
};
const context={workspaceState:{get:key=>memory.get(key),update:async(key,value)=>{
 if(saveFailure){saveFailure=false;throw Error("Save failed")};if(value===undefined)memory.delete(key);else memory.set(key,structuredClone(value));
}}};
const filename=path.join(root,"packages/vscode/src/presets.ts"),mod=new Module(filename);
mod.require=name=>{assert.equal(name,"vscode");return api};
mod._compile(esbuild.transformSync(fs.readFileSync(filename,"utf8"),{loader:"ts",format:"cjs"}).code,filename);
const make=()=>new mod.exports.PresetController(context,async value=>{
 calls.push({...value});await apply(value);const project=canonical(value);return{...state(project),selectedProjectUri:project};
},async project=>({presets:["android","ios"].map(name=>({name,uri:project+"config.toml"})),diagnostics:[]}),()=>locate(),(message,error)=>errors.push({message,error:String(error)}));
const choose=(projectUri,preset)=>commands.get("afl.selectPreset")({projectUri,preset});
const click=()=>commands.get("afl.selectPreset")(),clear=()=>commands.get("afl.check")();
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
(async()=>{
 // Migrate the old single selection without losing its desired preset.
 memory.set("afl.activePreset",{projectUri:a.replace(/\/$/,""),preset:"android"});
 let controller=make(),status=statuses.at(-1);controller.serverState(true);
 assert.equal(controller.current.projectUri,a);assert.match(status.text,/edge \/ android/);
 await controller.focus();await choose(a,"ios");
 assert(!memory.has("afl.activePreset"));assert.equal(memory.get("afl.projectPresets")[0].preset,"ios");
 await choose(b,"android");
 assert.equal(memory.get("afl.projectPresets").length,2);
 located=a;await controller.focus();assert.equal(controller.current.preset,"ios");
 located=b;await controller.focus();assert.equal(controller.current.preset,"android");
 // Resolving an older alias must preserve a newer choice for the same canonical project.
 const alias=a.replace("/edge/","/edge-alias/"),aliasGate=gate(),canonicalGate=gate();
 canonical=value=>value.projectUri===alias?a:value.projectUri;
 apply=value=>value.projectUri===alias?aliasGate.promise:canonicalGate.promise;
 const aliasOlder=choose(alias,"android");await tick();const canonicalNewer=choose(a,"ios");
 aliasGate.resolve();await tick();assert.equal(controller.current.projectUri,a);assert.equal(controller.current.preset,"ios");
 canonicalGate.resolve();await Promise.all([aliasOlder,canonicalNewer]);
 assert.equal(controller.current.preset,"ios");assert(!controller.selections.some(value=>value.projectUri===alias));
 assert.equal(memory.get("afl.projectPresets").find(value=>value.projectUri===a).preset,"ios");
 // Alias notifications may arrive while changes are queued; the newest desired state wins.
 const secondAlias=a.replace("/edge/","/second-edge-alias/"),oldGate=gate(),newGate=gate();
 canonical=value=>value.projectUri===secondAlias?a:value.projectUri;
 apply=value=>value.preset==="android"?oldGate.promise:newGate.promise;
 const canonicalOlder=choose(a,"android");await tick();const aliasNewer=choose(secondAlias,"ios");
 controller.updateProjects({...state(a),aliases:{[secondAlias]:a}});
 assert.equal(controller.current.projectUri,a);assert.equal(controller.current.preset,"ios");
 oldGate.resolve();await tick();assert.equal(controller.current.preset,"ios");newGate.resolve();await Promise.all([canonicalOlder,aliasNewer]);
 assert.equal(controller.current.preset,"ios");assert(!controller.selections.some(value=>value.projectUri===secondAlias));
 apply=async()=>{};canonical=value=>value.projectUri;located=b;await controller.focus();
 await clear();assert.equal(controller.current.projectUri,b);assert.equal(controller.current.preset,undefined);
 assert.equal(memory.get("afl.projectPresets").find(item=>item.projectUri===a).preset,"ios");
 // Delayed writes cannot pull the status back from a newer editor focus.
 const delayed=gate();apply=value=>value.projectUri===a&&value.preset==="android"?delayed.promise:Promise.resolve();
 const first=choose(a,"android");assert.match(status.text,/sync~spin.*edge \/ android/);await tick();
 located=b;await controller.focus();assert.match(status.text,/implementations \/ No preset/);
 delayed.resolve();await first;assert.equal(controller.current.projectUri,b);
 assert.equal(memory.get("afl.projectPresets").find(item=>item.projectUri===a).preset,"android");
 const older=gate();apply=value=>value.preset==="android"?older.promise:Promise.resolve();
 const one=choose(a,"android");await tick();const two=choose(a,"ios");
 assert.match(status.text,/edge \/ ios/);older.resolve();await Promise.all([one,two]);
 assert.equal(controller.current.preset,"ios");assert.equal(memory.get("afl.projectPresets").find(item=>item.projectUri===a).preset,"ios");
 const rejection=gate();apply=()=>rejection.promise;
 const failed=choose(a,"android");await tick();apply=async()=>{};const newer=choose(a,"ios");
 rejection.reject(Error("Earlier failure"));await Promise.all([failed,newer]);assert.equal(errors.length,0);
 apply=async()=>{throw Error("Unavailable")};await choose(b,"ios");assert.match(status.text,/warning.*ios/);
 assert.equal(memory.get("afl.projectPresets").find(item=>item.projectUri===b).preset,undefined);
 apply=async()=>{};await choose(b,"ios");saveFailure=true;await choose(b,"android");
 assert.match(status.tooltip,/could not be remembered/);assert.equal(controller.current.preset,"android");
 await choose(b,"android");assert(!status.tooltip.includes("could not be remembered"));
 // A command during file switching waits for the file's project, not the old status.
 const switching=gate();located=b;locate=()=>switching.promise;const locating=controller.focus();
 const beforeSwitch=calls.length;const check=clear();await tick();assert.equal(calls.length,beforeSwitch);
 switching.resolve(state(b));await Promise.all([locating,check]);assert.equal(calls.at(-1).projectUri,b);
 await choose(b,"android");
 // A slow discovery result must not replace a later explicit preset choice.
 const discovering=gate();locate=()=>discovering.promise;const focus=controller.focus();await choose(a,"ios");
 discovering.resolve(state(b));await focus;assert.equal(controller.current.projectUri,a);
 locate=async()=>state(located);
 picks=[];const before=calls.length;await click();assert.equal(calls.length,before);
 picks=["Choose project folder…","android"];dialogs=[[uri(b)]];await click();assert.equal(controller.current.projectUri,b);
 assert(items.some(item=>item.label==="No preset"));
 controller.dispose();assert.equal(commands.size,0);assert(status.disposed);
 controller=make();controller.serverState(true);located=a;await controller.focus();assert.equal(controller.current.preset,"ios");
 located=b;await controller.focus();assert.equal(controller.current.preset,"android");
 const previous=controller.current;await commands.get("afl.selectPreset")({projectUri:"bad URI",preset:"x"});assert.deepEqual(controller.current,previous);
 controller.serverFailed();assert.match(statuses.at(-1).text,/warning/);const failures=errors.length;await clear();assert.equal(errors.length,failures+1);controller.dispose();
 assert(statuses.every(item=>item.disposed));assert.equal(listener,undefined);
 console.log("Preset UI: project switching, independent persistence, legacy migration, delayed focus/writes, failures and disposal passed.");
})().catch(error=>{console.error(error);process.exitCode=1});
'###
  let result = (^node -e $bridge $root | complete)
  assert equal $result.exit_code 0 $result.stderr
  print ($result.stdout | str trim)
}
