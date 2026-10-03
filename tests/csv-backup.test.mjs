import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
const context = { window: {} };
vm.runInNewContext(readFileSync(new URL('../dist/backup.js', import.meta.url), 'utf8'), context);
const csv = context.window.MilkBackup;
const records = [{ id: '=formula,"\n中文', at: 1790972345123, amount: 110, auto: true }, { id: "'id", at: 1790880000000, amount: 120, auto: false }];
test('CSV 带BOM且特殊编号/毫秒/旧奶量/自动标记无损往返，转义公式', () => {
  const encoded = csv.encode(records);
  assert.ok(encoded.startsWith('\ufeff记录编号,'));
  assert.ok(encoded.includes("'=formula"));
  assert.deepEqual(JSON.parse(JSON.stringify(csv.decode(encoded))).sort((a,b)=>a.at-b.at), records.slice().sort((a,b)=>a.at-b.at));
});
test('空记录可往返；LF与末尾空行可读取', () => {
  assert.equal(csv.decode(csv.encode([])).length, 0);
  assert.equal(csv.decode(csv.encode(records).replace(/\r\n/g,'\n')+'\n').length, 2);
});
test('拒绝缺列/重复ID/非法奶量/自动标记/时间戳/损坏引号，不部分导入', () => {
  const header = csv.encode([]);
  const row = 'id,2026-10-03,09:00:00.000,120,否,1790989200000\r\n';
  for (const input of ['bad', header+row+row, header+row.replace(',120,',',0,'), header+row.replace(',120,',',120.5,'), header+row.replace(',否,',',maybe,'), header+row.replace('1790989200000','NaN'), header+'"unterminated']) assert.throws(()=>csv.decode(input));
});
test('拒绝超大文件、超多记录，拒绝日期列被编辑后与时间戳不符', () => {
  assert.throws(()=>csv.decode('x'.repeat(1048577)));
  assert.throws(()=>csv.encode(Array.from({length:10001},(_,i)=>({...records[0],id:String(i)}))));
  assert.throws(()=>csv.decode(csv.encode(records).replace(/2026-\d\d-\d\d/,'2000-01-01')));
});

test('跨时区 CSV 保留原始时刻，不使用当前设备时区重建记录', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ='Asia/Shanghai'; const text=csv.encode(records);
    process.env.TZ='America/Los_Angeles';
    assert.equal(csv.decode(text)[0].at,records[1].at);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ=previous; }
});
