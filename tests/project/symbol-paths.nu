use ../support.nu temporary-directory
use std/assert

def main [] {
  let tool = ($env.FILE_PWD | path dirname | path dirname)
  let temporary = (temporary-directory "symbol-paths")
  try {
    let bridge = r###'
      import assert from "node:assert/strict";
      import {mkdirSync,readFileSync,writeFileSync,cpSync,realpathSync,symlinkSync} from "node:fs";
      import {join} from "node:path";
      import {pathToFileURL} from "node:url";
      import {execFileSync} from "node:child_process";
      const [tool,tmp]=process.argv.slice(1), root=join(realpathSync(tmp),'project');
      const {LanguageService,symbolPath}=await import(pathToFileURL(join(tool,'packages/checker/dist/index.js')));
      const {loadProject}=await import(pathToFileURL(join(tool,'packages/checker/dist/node.js')));
      const write=(file,text)=>{mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),text);};
      const shared='[crate]\nid="ui"\n[dep]\n', app='[crate]\nid="app"\n[dep]\nui="../shared"\nsecond="../shared"\n';
      const source='class Button [desc=[Button]] {\nvalue:i32=1 [desc=[Value]]\nfn show() -> i32 [return=[Value]] { self.value }\n}\n'+
        'fn echo(value:i32) -> i32 [value=[Input]\nreturn=[Result]] { local:i32=value\nlocal }\n'+
        'struct Record [desc=[Record]] {\n"":string [desc=[Empty]]\n"a.b":string [desc=[Dot]]\n"礼物/#%":string [desc=[Unicode]]\n}\n'+
        'type State = "ready" [desc=[State]]\nconst limit:i32=1 [desc=[Limit]]\nfn `return`() {}\n';
      write('shared/config.toml',shared);write('shared/lib.afl',source);
      write('shared/folder name/unicode 模块.afl','fn extra() {}\n');
      write('app/config.toml',app);write('app/main.afl','use dep::ui::lib::Button as View\nuse dep::second::lib::echo\nfn main() { v:View={value:echo(1)}\nv.show() }\n');
      const load=async(base=root,overlays=[])=>{
        const project=await loadProject([join(base,'app')],overlays);
        const service=new LanguageService();service.update(project.documents,project);
        assert.deepEqual(service.diagnostics,[]);return {project,service};
      };
      let {project,service}=await load();
      assert.equal(project.crates.length,2,'dependency aliases share one crate');
      const ui=project.crates.find(c=>c.id==='ui'), consumer=project.crates.find(c=>c.id==='app');
      const uri=new URL('lib.afl',ui.root).href;
      const point=(text,needle,offset=0)=>{const before=text.slice(0,text.indexOf(needle)+offset).split('\n');return {line:before.length-1,character:before.at(-1).length};};
      const check=(name,needle,offset=0)=>{
        const path=symbolPath(ui,uri,name), location=service.resolveSymbol(path);
        assert(location,path);assert.equal(service.symbolPath(uri,point(source,needle,offset)),path);
        assert.deepEqual(location,{uri,range:location.range});return path;
      };
      check('Button','Button');check('Button.value','value:i32');check('Button.show','show');check('echo','echo');
      check('Record.','""');check('Record.a.b','"a.b"');check('Record.礼物/#%','"礼物/#%"');
      check('State','State');check('limit','limit');check('return','`return`');
      assert.equal(service.symbolPath(uri,point(source,'local:i32')),undefined);
      assert.equal(service.symbolPath(uri,point(source,'echo(value:i32',5)),undefined);
      assert.equal(service.symbolPath(new URL('main.afl',consumer.root).href,{line:3,character:3}),'afl://ui/lib.afl#Button.show');
      for(const path of ['dep::ui::lib::Button.show','dep::second::lib::Button.show'])assert.deepEqual(service.resolveSymbol(path,consumer.root),service.resolveSymbol('afl://ui/lib.afl#Button.show'));
      assert.deepEqual(service.resolveSymbol('crate::lib::Button.show',ui.root),service.resolveSymbol('afl://ui/lib.afl#Button.show'));
      assert.equal(service.resolveSymbol('dep::ui::lib::Button.show',ui.root),undefined);
      assert.equal(service.resolveSymbol('crate::lib::Button.show'),undefined);
      assert(service.resolveSymbol('afl://ui/folder%20name/unicode%20%E6%A8%A1%E5%9D%97.afl#extra'));
      for(const path of ['afl://unknown/lib.afl#Button','afl://ui/missing.afl#Button','afl://ui/lib.afl#missing','afl://ui/../app/main.afl#main',
        'afl://ui/%2e%2e/app/main.afl#main','afl://ui/a%2Flib.afl#Button','afl://ui/a%5Clib.afl#Button','afl://ui//lib.afl#Button',
        'afl://UI/lib.afl#Button','afl://ui/%6Cib.afl#Button','afl://ui/lib.afl?x#Button','afl://ui/lib.afl#%42utton','afl://ui/lib.afl#%',
        'crate::..::Button','dep::missing::lib::Button','dep::ui::lib::Button.nope'])assert.equal(service.resolveSymbol(path,consumer.root),undefined,path);
      // Source offsets, declaration order, dependency aliases and machine paths are not identity.
      const old=service.resolveSymbol('afl://ui/lib.afl#Button.show');
      write('shared/lib.afl','\n\nfn before() {}\n'+source);
      const moved=join(tmp,'moved project');cpSync(root,moved,{recursive:true});
      const relocated=await load(moved);
      const movedLocation=relocated.service.resolveSymbol('afl://ui/lib.afl#Button.show');
      assert.equal(movedLocation.range.start.line,old.range.start.line+3);
      assert.equal(relocated.service.symbolPath(movedLocation.uri,movedLocation.range.start),'afl://ui/lib.afl#Button.show');
      assert.deepEqual(service.resolveSymbol('afl://ui/lib.afl#Button.show'),old,'loaded service remains a snapshot');
      write('app/config.toml',app.replace('ui="','renamed="'));
      write('app/main.afl',readFileSync(join(root,'app/main.afl'),'utf8').replace('dep::ui::','dep::renamed::'));
      assert((await load()).service.resolveSymbol('afl://ui/lib.afl#Button.show'));
      symlinkSync(join(root,'shared'),join(root,'shared-alias'));
      write('app/config.toml',app.replace('ui="','renamed="').replace('second="../shared"','second="../shared-alias"'));
      assert.equal((await load()).project.crates.length,2);
      // Unsaved config changes update the same index; invalid identities fail at config loading.
      const changed=await load(root,[{uri:new URL('config.toml',ui.root).href,text:shared.replace('"ui"','"new_ui"')}]);
      assert(changed.service.resolveSymbol('afl://new_ui/lib.afl#Button'));assert.equal(changed.service.resolveSymbol('afl://ui/lib.afl#Button'),undefined);
      service.update(changed.project.documents,changed.project);
      assert(service.resolveSymbol('afl://new_ui/lib.afl#Button'));assert.equal(service.resolveSymbol('afl://ui/lib.afl#Button'),undefined);
      for(const config of ['[crate]\nid="app"','[crate]\nid="UPPER"','[crate]\nid="1bad"','[crate]\nid=""','[crate]\nname="ui"','crate="ui"','[crate]\nid="ui"\nother=true']) {
        write('shared/config.toml',config);const bad=await loadProject([join(root,'app')]);
        assert(bad.diagnostics.some(d=>d.code==='AFL3001'),config);
      }
      write('shared/config.toml',shared);
      const cli=join(tool,'packages/cli/dist/afl.js');
      const symbols=JSON.parse(execFileSync(process.execPath,[cli,'symbols',join(root,'shared'),'--json']));
      const button=symbols.results.find(r=>r.name==='Button');assert.equal(button.symbolPath,'afl://ui/lib.afl#Button');
      assert.equal(button.children.find(r=>r.name==='show').symbolPath,'afl://ui/lib.afl#Button.show');
      console.log('PASS stable symbol paths: declarations/members/quoted fields, aliases, relocation, source edits, snapshots, overlays, identity conflicts, CLI');
    '###
    let result = (^node --input-type=module -e $bridge $tool $temporary | complete)
    assert equal $result.exit_code 0 ($result.stdout + $result.stderr)
    print --no-newline $result.stdout
  } catch {|error| rm --recursive --force $temporary; error make $error }
  rm --recursive --force $temporary
}
