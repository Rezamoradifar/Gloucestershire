import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readDailyScheduling} from '../scripts/zero-start-automation.mjs';
const runWith=units=>(_cmd,args)=>{if(!units.includes(args.at(-1)))throw Error('inactive');};
test('ordered scheduling is active while its intentionally disabled legacy timer is stopped',()=>{
 assert.deepEqual(readDailyScheduling({fast:true},runWith(['globaldroptrade-smart-worker.timer'])),{kind:'ordered',active:true});
 assert.deepEqual(readDailyScheduling({fast:true},runWith(['globaldroptrade-zero-daily.timer'])),{kind:'legacy',active:true});
});
test('conflicting timers and unrelated profiles never report healthy scheduling',()=>{
 assert.deepEqual(readDailyScheduling({fast:true},runWith(['globaldroptrade-smart-worker.timer','globaldroptrade-zero-daily.timer'])),{kind:'conflict',active:false,blocker:'MULTIPLE_DAILY_SCHEDULERS_ACTIVE'});
 assert.deepEqual(readDailyScheduling({fast:false},runWith(['globaldroptrade-smart-worker.timer'])),{kind:'none',active:false});
});
