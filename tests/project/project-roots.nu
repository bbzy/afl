use ../support.nu temporary-directory
use std/assert

def main [] {
  let tool = ($env.FILE_PWD | path dirname | path dirname)
  let temp = (temporary-directory "project-roots")
  try {
    let bridge = r####'
import assert from "node:assert/strict";
import fs from "node:fs";
import {join, dirname} from "node:path";
import {pathToFileURL} from "node:url";
const [tool, temporary] = process.argv.slice(1), root = fs.realpathSync(temporary);
const uri = path => pathToFileURL(path).href;
const {ProjectRoots, loadProject, owningProject, directoryUri} = await import(uri(join(tool, "packages/checker/dist/node.js")));
const write = (path, text) => { fs.mkdirSync(dirname(path), {recursive:true}); fs.writeFileSync(path, text); };
const project = join(root,"repo/deep/app"), child = join(project,"tools/child");
write(join(project,"config.toml"),'[project]\n[preset.all]\ncore=["core", "tools/child/core"]\nedge=[]');
write(join(project,"core/config.toml"),'[crate]\nid="parent"');
write(join(project,"core/lib.afl"),'fn parent() {}');
write(join(child,"config.toml"),'[project]');
write(join(child,"core/config.toml"),'[crate]\nid="child"');
write(join(child,"core/lib.afl"),'fn child() {}');
write(join(root,"repo/ordinary/config.toml"),'[dep]');
write(join(root,"repo/node_modules/hidden/config.toml"),'[project]');
write(join(root,"outside/config.toml"),'[project]');
fs.symlinkSync(join(root,"outside"), join(root,"repo/linked"));
let reader = await ProjectRoots.create();
let projects = await reader.discover([join(root,"repo")]);
assert.deepEqual(projects.map(item=>item.uri).sort(), [directoryUri(project),directoryUri(child)].sort());
assert.equal(owningProject(uri(join(child,"core/lib.afl")),projects).uri,directoryUri(child));
assert.equal(owningProject(uri(join(project,"core/lib.afl")),projects).uri,directoryUri(project));
assert.equal(owningProject(uri(join(root,"repo/deep/application/file.afl")),projects),undefined);
assert.deepEqual(await reader.discover([join(project,"core")]),[],"discovery must not ascend outside the workspace");
let loaded=await loadProject([project],[],{project:true});
assert.deepEqual(loaded.diagnostics,[]);
assert.deepEqual(loaded.documents.map(item=>item.uri),[uri(join(project,"core/lib.afl"))]);
loaded=await loadProject([project],[],{preset:"all"});
assert.deepEqual(loaded.diagnostics,[]);
assert.equal(loaded.documents.length,2,"explicit selections may cross nested project boundaries");
const legacy=join(root,"legacy");
write(join(legacy,"config.toml"),'[preset.a]\ncore=["core"]\nedge=[]');
write(join(legacy,"core/config.toml"),'[dep]');
write(join(legacy,"core/lib.afl"),'fn old() {}');
assert((await loadProject([legacy],[],{preset:"a"})).diagnostics.some(item=>item.code==="AFL4003"));
assert.deepEqual((await loadProject([join(legacy,"core")])).diagnostics,[],"ordinary crates do not require project markers");
const config=uri(join(project,"config.toml"));
reader=await ProjectRoots.create([{uri:config,text:'[project]\nunknown=true'}]);
assert((await reader.root(project)).diagnostics.some(item=>item.code==="AFL4003"));
reader=await ProjectRoots.create([{uri:config,text:'[project]\n[preset.'}]);
const broken=await reader.discover([join(root,"repo")],projects);
assert(broken.find(item=>item.uri===directoryUri(project)).diagnostics.some(item=>item.code==="AFL4001"));
reader=await ProjectRoots.create([{uri:config,text:'[dep]'}]);
assert(!(await reader.discover([join(root,"repo")],projects)).some(item=>item.uri===directoryUri(project)),"valid marker removal takes effect");
const virtual=join(root,"repo/new"), virtualUri=uri(join(virtual,"config.toml"));
reader=await ProjectRoots.create([{uri:virtualUri,text:'[project]'}]);
assert((await reader.discover([join(root,"repo")])).some(item=>item.uri===directoryUri(virtual)));
const alias=join(root,"alias");fs.symlinkSync(project,alias);
reader=await ProjectRoots.create();
assert.equal((await reader.discover([alias,project])).filter(item=>item.uri===directoryUri(project)).length,1);
write(join(root,"empty/config.toml"),'[project]');
assert.deepEqual((await loadProject([join(root,"empty")],[],{project:true})).diagnostics,[]);
const nestedCrate=join(project,"core/nested");
write(join(nestedCrate,"config.toml"),'[project]');write(join(nestedCrate,"lib.afl"),'fn nested() {}');
assert((await loadProject([project],[],{project:true})).diagnostics.some(item=>item.code==="AFL3000"),"project markers must not legalize nested crates");
fs.unlinkSync(join(project,"config.toml"));
assert(!(await (await ProjectRoots.create()).discover([join(root,"repo")],projects)).some(item=>item.uri===directoryUri(project)));
console.log("Project roots: markers, boundaries, nested isolation, explicit cross-project selection, overlays, aliases and migration passed.");
'####
    let result = (^node --input-type=module -e $bridge $tool $temp | complete)
    assert equal $result.exit_code 0 $result.stderr
    print ($result.stdout | str trim)
  } catch {|err| rm -rf $temp; error make $err }
  rm -rf $temp
}
