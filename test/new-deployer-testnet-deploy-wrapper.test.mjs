import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {Wallet} from 'ethers';

const sourceFile=new URL('../ubuntu-deploy-new-deployer-testnet.sh',import.meta.url);
const deploymentSource=fs.readFileSync(new URL('../scripts/deploy-new-deployer-testnet.mjs',import.meta.url),'utf8');

test('key setup installs runtime dependencies before it can prompt for a secret',()=>{
    const source=fs.readFileSync(sourceFile,'utf8');
    assert.equal(spawnSync('bash',['-n',sourceFile.pathname],{encoding:'utf8'}).status,0);
    assert.match(source,/if \[ "\$mode" = --setup-key \]; then\n install_runtime_dependencies\n setup_key\n exit 0\nfi/);
    assert.match(source,/fs\.linkSync\(temporary,target\)/);
    assert.match(source,/NEW_DEPLOYER_KEY_ALREADY_EXISTS_PRESERVED/);
    assert.doesNotMatch(source,/echo \"\$entered_key\"|echo '\$entered_key'/);
    assert.match(source,/legacy_unit_quiescent \|\| exit 1\nhold_legacy_locks \|\| exit 1\nlegacy_unit_quiescent \|\| exit 1/);
    assert.match(source,/globaldroptrade-zero-daily\.service/);
    assert.match(source,/globaldroptrade-automation\.timer/);
    assert.match(source,/fresh-fast-testnet-connection\/run\.lock/);
    assert.match(source,/smart-worker-v1\/run\.lock/);
    assert.match(source,/fresh-zero-automation-v1\/run\.lock/);
    assert.match(source,/UnitFileState/);
    assert.match(source,/O_CREAT\|fs\.constants\.O_EXCL\|fs\.constants\.O_RDWR\|fs\.constants\.O_NOFOLLOW/);
    assert.match(source,/fs\.fstatSync\(descriptor\)/);
    assert.match(source,/catch\{throw Error\("NEW_DEPLOYER_KEY_INVALID"\);\}/);
    assert.match(source,/if\(created&&temporary\)\{try\{fs\.unlinkSync\(temporary\);\}catch\{\}\}/);
    assert.doesNotMatch(source,/node --input-type=module -e '[\s\S]*' "\$entered_key"/);
    assert.doesNotMatch(source,/systemctl stop/);
    assert.match(deploymentSource,/function newDeployerWallet\(key,provider\)[\s\S]{0,140}catch \{ fail\('NEW_DEPLOYER_KEY_INVALID'\); \}/);
});

test('invalid, wrong-address, and failed key writes never print or retain supplied key material',()=>{
    const secret='0x'+'01'.repeat(32),invalid='0x'+'00'.repeat(32),overflow='0x'+'ff'.repeat(32);
    const run=({input,expected,writeFailure=false,preserved=false,tempCollision=false})=>{
        const root=fs.mkdtempSync(path.join(os.tmpdir(),'new-deployer-secret-'));
        try{
            const state=path.join(root,'state'),keys=path.join(root,'keys'),script=path.join(root,'deploy.sh'),bin=path.join(root,'bin');
            fs.mkdirSync(bin);
            fs.writeFileSync(path.join(bin,'npm'),'#!/bin/sh\nexit 0\n',{mode:0o755});
            fs.symlinkSync(path.resolve('node_modules'),path.join(root,'node_modules'));
            if(writeFailure||preserved||tempCollision)fs.mkdirSync(keys,{mode:0o700});
            if(preserved)fs.writeFileSync(path.join(keys,'deployer.key'),'preserved\n',{mode:0o600});
            let source=fs.readFileSync(sourceFile,'utf8');
            source=source.replace('[ "$(id -u)" -eq 0 ] || { echo \'ROOT_REQUIRED\'; exit 1; }','[ "0" -eq 0 ] || { echo \'ROOT_REQUIRED\'; exit 1; }');
            source=source.replaceAll('uid!==0','uid!==process.getuid()');
            source=source.replace('/var/lib/globaldroptrade/new-deployer-testnet-v1',state);
            source=source.replace('/etc/globaldroptrade/new-deployer-testnet-v1',keys);
            if(expected)source=source.replace('expected=0xCf6Eb63ba4D2174CA2759eff57a720a54416b71d','expected='+expected);
            if(writeFailure)source=source.replace('fs.linkSync(temporary,target);','throw Error("SIMULATED_KEY_WRITE_FAILURE");');
            if(tempCollision){
                source=source.replace('".deployer.key."+process.pid+"."+Date.now()','".deployer.key.collision"');
                fs.writeFileSync(path.join(keys,'.deployer.key.collision'),'sentinel\n',{mode:0o600});
            }
            fs.writeFileSync(script,source,{mode:0o755});
            const result=spawnSync('bash',[script,'--setup-key'],{cwd:root,input:input+'\n',encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH}});
            const output=result.stdout+result.stderr;
            assert.notEqual(result.status,0);
            assert.equal(output.includes(input),false);
            if(tempCollision)assert.equal(fs.readFileSync(path.join(keys,'.deployer.key.collision'),'utf8'),'sentinel\n');
            else assert.equal(fs.readdirSync(keys).some(name=>name.startsWith('.deployer.key.')),false);
            if(preserved)assert.equal(fs.readFileSync(path.join(keys,'deployer.key'),'utf8'),'preserved\n');
            else assert.equal(fs.existsSync(path.join(keys,'deployer.key')),false);
        }finally{fs.rmSync(root,{recursive:true,force:true});}
    };
    run({input:invalid});
    run({input:overflow});
    run({input:secret});
    run({input:secret,expected:new Wallet(secret).address,writeFailure:true});
    run({input:secret,expected:new Wallet(secret).address,tempCollision:true});
    run({input:secret,preserved:true});
});

test('a checkout without node_modules invokes npm before setup key input',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'new-deployer-wrapper-'));
    try{
        const state=path.join(root,'state'),keys=path.join(root,'keys'),script=path.join(root,'deploy.sh'),bin=path.join(root,'bin'),log=path.join(root,'npm.log');
        fs.mkdirSync(bin);
        fs.writeFileSync(path.join(bin,'npm'),'#!/bin/sh\nprintf "%s\\n" "$*" >> "$MOCK_NPM_LOG"\n',{mode:0o755});
        let source=fs.readFileSync(sourceFile,'utf8');
        source=source.replace('[ "$(id -u)" -eq 0 ] || { echo \'ROOT_REQUIRED\'; exit 1; }','[ "0" -eq 0 ] || { echo \'ROOT_REQUIRED\'; exit 1; }');
        source=source.replace('/var/lib/globaldroptrade/new-deployer-testnet-v1',state);
        source=source.replace('/etc/globaldroptrade/new-deployer-testnet-v1',keys);
        fs.writeFileSync(script,source,{mode:0o755});
        const result=spawnSync('bash',[script,'--setup-key'],{
            cwd:root,input:'',encoding:'utf8',
            env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,MOCK_NPM_LOG:log}
        });
        assert.notEqual(result.status,0,'empty hidden input must not create a key');
        assert.equal(fs.existsSync(path.join(root,'node_modules')),false);
        assert.match(fs.readFileSync(log,'utf8'),/^ci --omit=dev --ignore-scripts --no-audit --no-fund\n$/);
        assert.equal(fs.existsSync(path.join(keys,'deployer.key')),false);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
});
