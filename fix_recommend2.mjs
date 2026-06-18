import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── 1. supabase.ts: 필터 파라미터 추가 ────────────────────────────────────
const sbPath = join(__dirname, 'src', 'lib', 'supabase.ts');
let sbContent = readFileSync(sbPath, 'utf8');

sbContent = sbContent.replace(
`export async function getRecommendedProducts(
  uwThreshold: number,
  limit: number = 5
) {
  console.log(\`[Supabase] 추천 조회: 열관류율 <= \${uwThreshold}, limit: \${limit}\`);

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .lte('열관류율', uwThreshold)
    .order('열관류율', { ascending: true })
    .limit(limit);`,
`export async function getRecommendedProducts(
  uwThreshold: number,
  limit: number = 5,
  glassConfig?: string,
  gasType?: string,
  frameType?: string
) {
  console.log(\`[Supabase] 추천 조회: 열관류율 <= \${uwThreshold}, 유리구성: \${glassConfig||'전체'}, 충전기체: \${gasType||'전체'}, 프레임재질: \${frameType||'전체'}, limit: \${limit}\`);

  let query = supabase
    .from('products')
    .select('*')
    .lte('열관류율', uwThreshold);

  if (glassConfig && glassConfig !== '전체') {
    query = query.eq('유리구성', glassConfig);
  }
  if (gasType && gasType !== '전체') {
    query = query.eq('충전기체', gasType);
  }
  if (frameType && frameType !== '전체') {
    query = query.eq('프레임재질', frameType);
  }

  query = query
    .order('열관류율', { ascending: true })
    .limit(limit);

  const { data, error } = await query;`
);

writeFileSync(sbPath, sbContent, 'utf8');
console.log('✅ supabase.ts 수정 완료');

// ─── 2. App.tsx: 여러 위치 수정 ─────────────────────────────────────────────
const appPath = join(__dirname, 'src', 'App.tsx');
const appContent = readFileSync(appPath, 'utf8');
const lines = appContent.split('\n');

let changes = 0;

// ── 2a. recommendInput state: area 제거, 필터 3개 추가 ─────────────────────
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const [recommendInput, setRecommendInput] = useState(') && 
      lines[i].includes('area: 15')) {
    lines[i] = lines[i].replace(
      '{ region: "central2", buildingType: "residential_apartment", contactType: "direct", area: 15 }',
      '{ region: "central2", buildingType: "residential_apartment", contactType: "direct", glassConfig: "\uc804\uccb4", gasType: "\uc804\uccb4", frameType: "\uc804\uccb4" }'
    );
    console.log(`✅ 2a. recommendInput state 수정 at line ${i+1}`);
    changes++;
    break;
  }
}

// ── 2b. 클릭 핸들러: getRecommendedProducts 호출에 필터 파라미터 추가 ────────
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const products = await getRecommendedProducts(uwThreshold, 5)')) {
    lines[i] = lines[i].replace(
      'const products = await getRecommendedProducts(uwThreshold, 5)',
      'const products = await getRecommendedProducts(uwThreshold, 5, recommendInput.glassConfig, recommendInput.gasType, recommendInput.frameType)'
    );
    console.log(`✅ 2b. 클릭 핸들러 수정 at line ${i+1}`);
    changes++;
    break;
  }
}

// 변경사항 저장 (임시 - 2c,2d,2e는 블록 교체가 필요)
writeFileSync(appPath, lines.join('\n'), 'utf8');

// ─── 2c-2e. 블록 교체: 폼·결과카드 ─────────────────────────────────────────
let appContent2 = readFileSync(appPath, 'utf8');

// ── 2c. 입력폼: 창호면적 InputField 삭제 + 선택 필터 3개 추가 ─────────────
// 찾을 블록: 설치 조건 입력 Card 내부의 grid div 전체
const OLD_FORM_GRID = `                           <Card title="\uc124\uce58 \uc870\uac74 \uc785\ub825" icon={Settings2}>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                              <SelectField
                                label="\ubd84\uc11d \uc9c0\uc5ed"
                                value={recommendInput.region}
                                onChange={(v: string) => setRecommendInput(p => ({ ...p, region: v }))}
                                options={Object.entries(REGIONS).map(([k, v]) => ({ value: k, label: v.name }))}
                              />
                              <SelectField
                                label="\uac74\ubb3c \uc6a9\ub3c4"
                                value={recommendInput.buildingType}
                                onChange={(v: string) => setRecommendInput(p => ({ ...p, buildingType: v }))}
                                options={BUILDING_TYPES}
                              />
                              <SelectField
                                label="\uc678\uae30 \uc811\ucd09 \uc5ec\ubd80"
                                value={recommendInput.contactType}
                                onChange={(v: string) => setRecommendInput(p => ({ ...p, contactType: v }))}
                                options={CONTACT_TYPES}
                              />
                              <InputField
                                label="\ucc3d\ud638 \uba74\uc801 (m\u00b2)"
                                value={recommendInput.area}
                                onChange={(v: string) => setRecommendInput(p => ({ ...p, area: parseFloat(v) || 15 }))}
                              />
                            </div>
                          </Card>`;

const NEW_FORM_GRID = `                           <Card title="\uc124\uce58 \uc870\uac74 \uc785\ub825" icon={Settings2}>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                              <SelectField
                                label="\ubd84\uc11d \uc9c0\uc5ed"
                                value={recommendInput.region}
                                onChange={(v: string) => setRecommendInput(p => ({ ...p, region: v }))}
                                options={Object.entries(REGIONS).map(([k, v]) => ({ value: k, label: v.name }))}
                              />
                              <SelectField
                                label="\uac74\ubb3c \uc6a9\ub3c4"
                                value={recommendInput.buildingType}
                                onChange={(v: string) => setRecommendInput(p => ({ ...p, buildingType: v }))}
                                options={BUILDING_TYPES}
                              />
                              <SelectField
                                label="\uc678\uae30 \uc811\ucd09 \uc5ec\ubd80"
                                value={recommendInput.contactType}
                                onChange={(v: string) => setRecommendInput(p => ({ ...p, contactType: v }))}
                                options={CONTACT_TYPES}
                              />
                            </div>
                          </Card>

                          <Card title="\uc120\ud0dd \ud544\ud130 (\uc120\ud0dd\uc0ac\ud56d)" icon={Search}>
                            <p className="text-[11px] mb-4" style={{ color: "var(--color-text-sub)" }}>
                              \uc804\uccb4\ub97c \uc120\ud0dd\ud558\uba74 \ud574\ub2f9 \uc870\uac74\uc73c\ub85c \ud544\ud130\ub9c1\ud558\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <SelectField
                                label="\uc720\ub9ac\uad6c\uc131"
                                value={recommendInput.glassConfig}
                                onChange={(v: string) => setRecommendInput(p => ({ ...p, glassConfig: v }))}
                                options={[
                                  { value: "\uc804\uccb4", label: "\uc804\uccb4" },
                                  { value: "\ubcf5\uce35", label: "\ubcf5\uce35" },
                                  { value: "\uc0bc\uc911", label: "\uc0bc\uc911" },
                                ]}
                              />
                              <SelectField
                                label="\ucda9\uc804\uae30\uccb4"
                                value={recommendInput.gasType}
                                onChange={(v: string) => setRecommendInput(p => ({ ...p, gasType: v }))}
                                options={[
                                  { value: "\uc804\uccb4", label: "\uc804\uccb4" },
                                  { value: "\uc544\ub974\uace4", label: "\uc544\ub974\uace4" },
                                  { value: "\uae30\ud0c0", label: "\uae30\ud0c0" },
                                ]}
                              />
                              <SelectField
                                label="\ud504\ub808\uc784\uc7ac\uc9c8"
                                value={recommendInput.frameType}
                                onChange={(v: string) => setRecommendInput(p => ({ ...p, frameType: v }))}
                                options={[
                                  { value: "\uc804\uccb4", label: "\uc804\uccb4" },
                                  { value: "\uc54c\ub8e8\ubbf8\ub284", label: "\uc54c\ub8e8\ubbf8\ub284" },
                                  { value: "PVC", label: "PVC" },
                                  { value: "\uae30\ud0c0", label: "\uae30\ud0c0" },
                                ]}
                              />
                            </div>
                          </Card>`;

if (appContent2.includes(OLD_FORM_GRID)) {
  appContent2 = appContent2.replace(OLD_FORM_GRID, NEW_FORM_GRID);
  console.log('✅ 2c. 폼 수정 완료 (창호면적 삭제 + 선택 필터 추가)');
  changes++;
} else {
  console.log('❌ 2c. 폼 블록을 찾지 못했습니다 — 수동 확인 필요');
}

// ── 2d. 결과카드: energySaving/co2Saving 계산 삭제 + 두 셀 삭제 ─────────────
// 찾을 블록: map callback 시작부의 계산 3줄
const OLD_CALC = `                                const uw = typeof product.\uc5f4\uad00\ub958\uc728 === 'number' ? product.\uc5f4\uad00\ub958\uc728 : parseFloat(product.\uc5f4\uad00\ub958\uc728);
                                const energySaving = Math.round((uwThreshold - uw) * area * hdd * 24 / 1000);
                                const co2Saving = Math.round(energySaving * 0.4599);
                                const loweLabel = product.\ub85c\uc774\uc5ec\ubd80 === true || product.\ub85c\uc774\uc5ec\ubd80 === 'true' || product.\ub85c\uc774\uc5ec\ubd80 === 1 ? '\uc801\uc6a9' : '\ubbf8\uc801\uc6a9';`;

const NEW_CALC = `                                const uw = typeof product.\uc5f4\uad00\ub958\uc728 === 'number' ? product.\uc5f4\uad00\ub958\uc728 : parseFloat(product.\uc5f4\uad00\ub958\uc728);
                                const loweLabel = product.\ub85c\uc774\uc5ec\ubd80 === true || product.\ub85c\uc774\uc5ec\ubd80 === 'true' || product.\ub85c\uc774\uc5ec\ubd80 === 1 ? '\uc801\uc6a9' : '\ubbf8\uc801\uc6a9';`;

if (appContent2.includes(OLD_CALC)) {
  appContent2 = appContent2.replace(OLD_CALC, NEW_CALC);
  console.log('✅ 2d. 에너지/CO2 계산 삭제 완료');
  changes++;
} else {
  console.log('❌ 2d. 에너지 계산 블록을 찾지 못했습니다');
}

// ── 2e. 결과 카드: 에너지절감·CO2저감 셀 두 개 삭제 ─────────────────────────
const OLD_ENERGY_CELLS = `                                      <div className="rounded-xl p-3 text-center col-span-2 sm:col-span-1 bg-emerald-500/5 border border-emerald-500/20">
                                        <p className="text-[10px] font-bold uppercase tracking-wider mb-1 text-emerald-600 dark:text-emerald-400">\uc5d0\ub108\uc9c0 \uc808\uac10</p>
                                        <p className="text-xs font-black text-emerald-500">{energySaving >= 0 ? energySaving.toLocaleString() : 0} kWh/\ub144</p>
                                      </div>
                                      <div className="rounded-xl p-3 text-center bg-blue-500/5 border border-blue-500/20">
                                        <p className="text-[10px] font-bold uppercase tracking-wider mb-1 text-blue-500 dark:text-blue-400">CO2 \uc800\uac10</p>
                                        <p className="text-xs font-black text-blue-500">{co2Saving >= 0 ? co2Saving.toLocaleString() : 0} kg/\ub144</p>
                                      </div>`;

if (appContent2.includes(OLD_ENERGY_CELLS)) {
  appContent2 = appContent2.replace(OLD_ENERGY_CELLS, '');
  console.log('✅ 2e. 에너지절감·CO2저감 셀 삭제 완료');
  changes++;
} else {
  console.log('❌ 2e. 에너지·CO2 셀을 찾지 못했습니다');
}

// ── 2f. IIFE 내부의 uwThreshold/hddMap/hdd/area 계산 변수들 정리 ────────────
// results IIFE 내부에 더이상 hdd, area가 필요없으므로 제거
const OLD_IIFE_VARS = `                          const uwThreshold = U_VALUE_THRESHOLDS[recommendInput.buildingType]?.[recommendInput.contactType]?.[recommendInput.region] ?? 1.0;
                          const hddMap: Record<string, number> = { central1: 3320, central2: 2880, south: 1900, jeju: 1200 };
                          const hdd = hddMap[recommendInput.region] ?? 2880;
                          const area = typeof recommendInput.area === 'string' ? parseFloat(recommendInput.area) : (recommendInput.area || 15);
                          return (`;

const NEW_IIFE_VARS = `                          const uwThreshold = U_VALUE_THRESHOLDS[recommendInput.buildingType]?.[recommendInput.contactType]?.[recommendInput.region] ?? 1.0;
                          return (`;

if (appContent2.includes(OLD_IIFE_VARS)) {
  appContent2 = appContent2.replace(OLD_IIFE_VARS, NEW_IIFE_VARS);
  console.log('✅ 2f. IIFE 내부 불필요 변수 정리 완료');
  changes++;
} else {
  console.log('❌ 2f. IIFE 변수 블록을 찾지 못했습니다');
}

writeFileSync(appPath, appContent2, 'utf8');
console.log(`\n총 ${changes}/6 변경 완료`);
