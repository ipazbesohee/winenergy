import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY as string;

// 환경변수 디버그
console.log('[Supabase] URL:', supabaseUrl ? `${supabaseUrl.substring(0, 30)}...` : '❌ 없음');
console.log('[Supabase] KEY:', supabaseKey ? `${supabaseKey.substring(0, 20)}...` : '❌ 없음');

if (!supabaseUrl || !supabaseKey) {
  console.error('[Supabase] ❌ 환경변수가 설정되지 않았습니다. .env 파일을 확인하고 dev 서버를 재시작하세요.');
}

export const supabase = createClient(supabaseUrl || '', supabaseKey || '');

/**
 * products 테이블에서 열관류율이 주어진 값 이하인 제품을 조회합니다.
 * - 효율등급 오름차순 정렬
 * - 최대 10개 반환
 * - frameType이 주어지면 프레임재질도 필터링
 * - glassConfig, loweCoating 필터링 추가 연동
 */
export async function getProductsByUValue(
  uValue: number,
  frameType?: string,
  glassConfig?: string,
  loweCoating?: string,
  isStrictlyLower: boolean = false,
  limit: number = 100
) {
  const comparisonOp = isStrictlyLower ? '<' : '<=';
  console.log(`[Supabase] 제품 조회: 열관류율 ${comparisonOp} ${uValue}, 프레임재질: ${frameType || '전체'}, 유리구성: ${glassConfig || '전체'}, 로이코팅: ${loweCoating || '전체'}, limit: ${limit}`);

  let query = supabase
    .from('products')
    .select('*');

  if (isStrictlyLower) {
    query = query.lt('열관류율', uValue);
  } else {
    query = query.lte('열관류율', uValue);
  }

  query = query
    .order('효율등급', { ascending: true })
    .limit(limit);

  if (frameType && frameType !== '전체') {
    query = query.eq('프레임재질', frameType);
  }

  if (glassConfig) {
    const glassMap: Record<string, string> = {
      single: '단층',
      double: '복층',
      triple: '삼중'
    };
    const mappedGlass = glassMap[glassConfig];
    if (mappedGlass) {
      query = query.eq('유리구성', mappedGlass);
    }
  }

  if (loweCoating) {
    const isLowe = loweCoating === 'yes';
    query = query.eq('로이여부', isLowe);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[Supabase] 제품 조회 실패:', error.message);
    throw error;
  }

  console.log(`[Supabase] 조회 결과: ${data?.length || 0}개 제품`);
  return data;
}

/**
 * diagnoses 테이블에 진단 결과를 저장합니다.
 */
export async function saveDiagnosis(data: object) {
  const { data: result, error } = await supabase
    .from('diagnoses')
    .insert(data)
    .select();

  if (error) {
    console.error('진단 결과 저장 실패:', error.message);
    throw error;
  }

  return result;
}

/**
 * 통계 차트를 위해 products 테이블의 전체 데이터를 가져옵니다.
 * Supabase 기본 limit(1000)을 우회하기 위해 페이지네이션으로 전체 조회합니다.
 */
export async function getProductStats() {
  console.log('[Supabase] 통계 데이터 전체 조회 시작');

  // 1. 전체 건수 확인
  const { count, error: countError } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('[Supabase] 건수 조회 실패:', countError.message);
    throw countError;
  }

  const total = count || 0;
  console.log(`[Supabase] 전체 제품 수: ${total.toLocaleString()}`);

  if (total === 0) return [];

  // 2. 페이지네이션으로 전체 데이터 조회 (1,000건씩)
  const allData: any[] = [];
  const pageSize = 1000;

  for (let from = 0; from < total; from += pageSize) {
    const to = Math.min(from + pageSize - 1, total - 1);
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .range(from, to);

    if (error) {
      console.error(`[Supabase] 페이지 조회 실패 (${from}-${to}):`, error.message);
      throw error;
    }

    if (data) allData.push(...data);
  }

  console.log(`[Supabase] 통계 데이터 완료: ${allData.length.toLocaleString()}개 제품`);
  return allData;
}
