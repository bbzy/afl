use ../support.nu temporary-directory
use std/assert

def main [] {
  let root = ($env.FILE_PWD | path dirname | path dirname)
  let temp = (temporary-directory "format")
  let bridge = r#'
import assert from "node:assert/strict";
import {readFileSync, writeFileSync, readdirSync, mkdirSync, symlinkSync, statSync, chmodSync, renameSync, unlinkSync, constants} from "node:fs";
import fsp from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {spawnSync} from "node:child_process";
const [root,temp]=process.argv.slice(1);
const {formatDocument,parseDocument}=await import(pathToFileURL(join(root,"packages/checker/dist/index.js")));
const source=text=>({uri:"file:///format.afl",text});
const format=(text,options={})=>{const result=formatDocument(source(text),options);assert.deepEqual(result.diagnostics,[]);return result.text};
assert.equal(format("fn main(){value:i32=1+2\nif value>0{value=-value}else{value=0}}"),
  "fn main() {\n    value: i32 = 1 + 2\n    if value > 0 {\n        value = -value\n    } else {\n        value = 0\n    }\n}\n");
assert.equal(format("fn main(){return\ncall()}",{tabSize:2}),"fn main() {\n  return\n  call()\n}\n");
assert.equal(format("fn main(){call()}",{insertSpaces:false}),"fn main() {\n\tcall()\n}\n");
assert.equal(format("fn main(){}\n\n\n\nfn other(){}"),"fn main() {}\n\nfn other() {}\n");
assert.equal(format("fn main(){value:list<map<string,i32?>> = {}}"),"fn main() {\n    value: list<map<string, i32?>> = {}\n}\n");
assert.equal(format("fn main(){useful: (fn( i32 )-> string)? =[callback]}"),"fn main() {\n    useful: (fn(i32) -> string)? = [callback]\n}\n");
for(const text of ["fn main( {",'fn f(){s:string="bad\\q"}',"fn main(){[unfinished", "fn f(){return (1+2}",
 "fn main(){1=2}","fn main(){value:i32 = if true {1}}","fn main(){break}","fn main(){[Follow {@} contract]}"]) {
  const result=formatDocument(source(text));assert.equal(result.text,text);assert.ok(result.diagnostics.length);
}
const opaque='\uFEFFfn sample(a:i32)->string[\r\na=[中文 😀\r\n  exact   text ]\r\nreturn=r##[ raw ]#\r\n  words ]##\r\n]{value:string=r##"first\r\n  exact ]#"##\r\nreturn value}';
const formatted=format(opaque);
assert.ok(formatted.startsWith("\uFEFF"));assert.equal(formatted.endsWith("\r\n"),true);
const literals=text=>parseDocument(source(text)).opaqueSpans.map(s=>text.slice(s.start,s.end));
assert.deepEqual(literals(formatted),literals(opaque));assert.equal(format(formatted),formatted);
assert.throws(()=>format("",{tabSize:0}));assert.throws(()=>format("",{tabSize:1.5}));
const files=(path,suffix)=>readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()&&!entry.name.startsWith(".")?files(join(path,entry.name),suffix):entry.isFile()&&entry.name.endsWith(suffix)?[join(path,entry.name)]:[]);
let aflCount=0;
for(const file of [...files(join(root,"demo"),".afl"),...files(join(root,"tests/fixtures"),".afl")]) {
  const text=readFileSync(file,"utf8");
  for(const options of [{},{tabSize:2},{insertSpaces:false}]) {
    const result=format(text,options);assert.equal(format(result,options),result,file);assert.deepEqual(literals(result),literals(text),file);
  }
  aflCount++;
}
const cli=(...args)=>{const p=spawnSync(process.execPath,[join(root,"packages/cli/dist/afl.js"),...args],{encoding:"utf8"});return {code:p.status,stdout:p.stdout,stderr:p.stderr,json:p.stdout?JSON.parse(p.stdout):null}};
const project=join(temp,"project");mkdirSync(project);
const file=join(project,"main.afl"), tpl=join(project,"helper.tpl");
writeFileSync(file,"fn main(){call()}");chmodSync(file,0o640);writeFileSync(tpl,"unrelated native text");
mkdirSync(join(project,".git"));writeFileSync(join(project,".git/ignored.afl"),"broken");
const outside=join(temp,"outside.afl");writeFileSync(outside,"fn outside(){}");symlinkSync(outside,join(project,"linked.afl"));
// Personal workspace directory names have no special traversal behavior.
const personal=join(temp,"personal");mkdirSync(join(personal,".AGENT_GROUND"),{recursive:true});
const personalFile=join(personal,".AGENT_GROUND/value.afl");writeFileSync(personalFile,"fn value(){}");
assert.equal(cli("format",personal,"--json").code,0);
assert.equal(readFileSync(personalFile,"utf8"),"fn value() {}\n");
const first=cli("format",project,"--check","--json");assert.equal(first.code,1);assert.equal(first.json.files.length,1);assert.ok(first.json.files.every(f=>f.changed&&!f.written));
assert.equal(readFileSync(file,"utf8"),"fn main(){call()}");
const written=cli("format",project,"--json");assert.equal(written.code,0);assert.ok(written.json.files.every(f=>f.written));assert.equal(statSync(file).mode&0o777,0o640);
assert.equal(readFileSync(tpl,"utf8"),"unrelated native text");
assert.equal(readFileSync(outside,"utf8"),"fn outside(){}");assert.equal(cli("format",project,"--check","--json").code,0);
assert.equal(cli("format",file,"--tabs","--json").code,0);assert.equal(readFileSync(file,"utf8"),"fn main() {\n\tcall()\n}\n");
writeFileSync(file,"fn main(){call()}");writeFileSync(join(project,"bad.afl"),"fn broken(");
const cancelled=cli("format",project,"--json");assert.equal(cancelled.code,1);assert.ok(cancelled.json.files.every(f=>!f.written));assert.equal(readFileSync(file,"utf8"),"fn main(){call()}");
for(const args of [["format",file,"--indent-width","0"],["format",file,"--preset","x"],["check",file,"--tabs"],["format",join(project,"linked.afl")]])assert.equal(cli(...args,"--json").code,2,args.join(" "));
const invalid=join(temp,"invalid.afl");writeFileSync(invalid,Buffer.from([0xff]));assert.equal(cli("format",invalid,"--json").code,2);
// A source replaced during publication cannot redirect the formatter into an unrelated file.
const esbuild=await import(pathToFileURL(join(root,"node_modules/esbuild/lib/main.js")));
const formattingModule=join(temp,"format.mjs");
writeFileSync(formattingModule,esbuild.buildSync({entryPoints:[join(root,"packages/cli/src/format.ts")],bundle:true,write:false,platform:"node",format:"esm"}).outputFiles[0].text);
const {formatFiles}=await import(pathToFileURL(formattingModule));
const realOpen=fsp.open,realWriteFile=fsp.writeFile;
for(const stage of ["open","write"]){
 const raced=join(temp,`raced-${stage}.afl`),saved=raced+".saved",other=join(temp,`unrelated-${stage}.afl`),original="fn original(){call()}";
 writeFileSync(raced,original);writeFileSync(other,"Keep unrelated bytes");let injected=false;
 const replace=()=>{if(!injected){injected=true;renameSync(raced,saved);symlinkSync(other,raced);}};
 fsp.writeFile=async(path,...args)=>{if(String(path)===raced)replace();return realWriteFile(path,...args);};
 fsp.open=async(path,flags,...args)=>{
  const writer=String(path)===raced&&Boolean(flags&constants.O_RDWR);
  if(writer&&stage==="open")replace();
  const handle=await realOpen(path,flags,...args);
  if(writer&&stage==="write"){
   const write=handle.writeFile.bind(handle);handle.writeFile=async(...args)=>{replace();return write(...args);};
  }
  return handle;
 };
 syncBuiltinESMExports();
 try{
  await assert.rejects(formatFiles([raced],{},false));assert(injected);
  assert.equal(readFileSync(other,"utf8"),"Keep unrelated bytes");
  assert.equal(readFileSync(saved,"utf8"),stage==="open"?original:format(original));
 }finally{
  fsp.open=realOpen;fsp.writeFile=realWriteFile;syncBuiltinESMExports();
  if(injected){unlinkSync(raced);renameSync(saved,raced);}
 }
}
console.log(JSON.stringify({aflCount}));
'#
  try {
    let result = (^node --input-type=module -e $bridge $root $temp | complete)
    assert equal $result.exit_code 0 $result.stderr
    let counts = ($result.stdout | from json)
    print $"PASS formatting: ($counts.aflCount) AFL demos, opaque text, idempotence, safe CLI writes/checks"
  } catch {|error|
    rm --recursive --force $temp
    error make $error
  }
  rm --recursive --force $temp
}
