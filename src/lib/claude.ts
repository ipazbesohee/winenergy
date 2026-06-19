const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string;
const API_URL = '/anthropic/v1/messages';

export interface StrategicImprovement {
  title: string;
  description: string;
  energySavingsKwh: number;
  co2ReductionKg: number;
}

export interface ClaudeAnalysisResult {
  summary: string;
  detailedAnalysis: string;
  strategicImprovements: StrategicImprovement[];
  economicImpact: string;
  energySavingsKwh: number;
  co2ReductionKg: number;
}

/**
 * Claude API를 사용하여 창호 성능 심층 분석 리포트를 생성합니다.
 * Vite 프록시를 통해 CORS 우회하여 호출합니다.
 */
export async function getClaudeWindowAnalysis(data: {
  uValue: number;
  shgc: number;
  airtight: number;
  tdr: number;
  area: number;
  regionName: string;
  frame: string;
  buildingType: string;
  contactType: string;
  /** DB에서 조회한 실제 개선 후보 제품 목록 (열관류율 오름차순) */
  dbProducts?: Array<{ 모델명?: string; 열관류율: number; 효율등급?: number; 프레임재질?: string }>;
}): Promise<ClaudeAnalysisResult> {
  const frameLabelMap: Record<string, string> = {
    AL: '알루미늄',
    PVC: 'PVC',
    AL_PVC: '복합(AL+PVC)',
    WOOD: '목재',
    WOOD_AL: '복합(목재+AL)',
  };
  const frameLabel = frameLabelMap[data.frame] || data.frame;

  const buildingLabelMap: Record<string, string> = {
    residential_apartment: '주거 (공동주택)',
    residential_single: '주거 (단독주택)',
    non_residential: '비주거',
  };
  const contactLabelMap: Record<string, string> = {
    direct: '외기직접',
    indirect: '외기간접',
  };
  const buildingLabel = buildingLabelMap[data.buildingType] || data.buildingType;
  const contactLabel = contactLabelMap[data.contactType] || data.contactType;

  const systemPrompt = `당신은 대한민국 건물 에너지 효율 및 창호(Window) 성능 진단 전문가입니다. 
에너지절약설계기준, 패시브하우스 기준, KS F 2278 등 국내외 관련 표준에 정통하며, 
창호의 열관류율, 기밀성, 결로방지, 일사열취득률 등을 종합적으로 분석합니다.
반드시 한국어로 응답하고, 전문적이면서도 실용적인 분석을 제공하세요.

[에너지 절감량 및 CO2 계산 공식 — 반드시 이 공식을 사용하세요]

에너지 절감량:
Q절감(kWh/년) = (U현재 - U개선) × 창호면적(m²) × 난방도일 × 24 / 1000
(W → kWh 단위 변환: ÷1000 필수. 이 값은 kWh/년 단위임)

지역별 난방도일(°C·day):
- 중부1: 3,320
- 중부2(서울/경기 등): 2,880
- 남부: 1,900
- 제주: 1,200

CO2 절감량:
CO2(kg/년) = Q절감 × 0.4599
(한국 전력 배출계수 2022 기준, 환경부 고시)

[중요 지침]
- energySavingsKwh와 co2ReductionKg는 반드시 위 공식으로 계산한 구체적인 수치를 사용하세요.
- 임의로 추정하지 말고 입력받은 U-value, 창호면적, 지역 데이터를 공식에 대입해서 계산하세요.
- 개선 전략별 U개선 값은 해당 전략 적용 시 달성 가능한 현실적인 U-value를 사용하세요.
- 총 energySavingsKwh는 가장 효과적인 단일 전략의 절감량(중복 합산 금지)으로 계산하세요.

응답은 반드시 아래 JSON 형식으로만 출력하세요. JSON 형식으로만 응답하고 코드블록 없이 순수 JSON만 반환해줘. JSON 외의 텍스트(마크다운, 설명 등)는 절대 포함하지 마세요:
{
  "summary": "종합 진단 요약 (3~5문장, 전문적이고 신뢰감 있는 톤)",
  "detailedAnalysis": "각 지표별 심층 분석 (에너지 손실 관점에서 상세히)",
  "strategicImprovements": [
    {
      "title": "전략 제목 (10자 내외, 차트 표시용)",
      "description": "구체적인 개선 방안 설명 (공식 계산 근거 포함)",
      "energySavingsKwh": 연간 에너지 절감량(숫자, 공식 계산값),
      "co2ReductionKg": 연간 CO2 저감량(숫자, 공식 계산값)
    }
  ],
  "economicImpact": "경제적/환경적 효과 종합 분석",
  "energySavingsKwh": 총 연간 에너지 절감량(숫자, 공식 계산값),
  "co2ReductionKg": 총 연간 CO2 저감량(숫자, 공식 계산값)
}`;

  // 지역별 난방도일 매핑
  const hddMap: Record<string, number> = {
    '중부1': 3320,
    '중부2': 2880,
    '남부': 1900,
    '제주': 1200,
  };
  // regionName에 지역 키워드가 포함된 경우 매핑, 없으면 중부2 기본값
  const hdd = Object.entries(hddMap).find(([key]) => data.regionName.includes(key))?.[1] ?? 2880;

  const userPrompt = `다음 창호 성능 데이터를 분석하고 전문적인 심층 진단 보고서를 작성해주세요.

[입력 데이터]
- 지역: ${data.regionName}
- 건물 용도: ${buildingLabel}
- 외기 접촉 여부: ${contactLabel}
- 현재 열관류율 (U현재): ${data.uValue} W/m²·K
- 일사열취득률 (SHGC): ${data.shgc} (참고값)
- 기밀성 등급: ${data.airtight}등급
- 결로방지성능 (TDR): ${data.tdr}
- 프레임 재질: ${frameLabel}
- 창호 면적: ${data.area} m²
- 지역 난방도일 (HDD): ${hdd} °C·day

[에너지 절감량 계산 공식]
Q절감(kWh/년) = (U현재 - U개선) × ${data.area} m² × ${hdd} °C·day × 24 / 1000
CO2(kg/년) = Q절감 × 0.4599 (환경부 전력 배출계수 2022 기준)

[분석 요청]
1. 현재 성능에 대한 종합 요약 (전문적이고 신뢰감 있는 톤)
2. 각 지표별 심층 분석 (에너지 손실 관점에서 U-value, SHGC(참고용), 기밀성, TDR 각각 분석)
3. 아래 [DB 개선 후보 제품]을 각 전략의 U개선 값으로 사용하세요:
   - DB 제품의 실제 열관류율을 U개선으로 대입해 공식 계산 (임의 추정 금지)
   - 이미 계산된 절감량이 제공되면 그 수치를 그대로 사용
   - 계산 과정(U현재 - U개선, 면적, HDD 대입)을 description에 포함
4. 개선 시 예상되는 경제적/환경적 효과
5. 총 연간 에너지 절감량(kWh)과 CO2 저감량(kg) — DB 제품 기반 계산값만 사용

전략 제목은 차트에 표시하기 위해 10자 내외로 간결하게 작성해주세요.`;

  // DB 개선 후보 제품이 있으면 user prompt에 추가
  const productsPromptSection = (() => {
    if (!data.dbProducts || data.dbProducts.length === 0) {
      return `
[DB 개선 후보 제품]
현재 열관류율(${data.uValue} W/m²·K)보다 낮은 인증 제품이 DB에 없습니다.
이 경우 "이미 DB 내 최고 수준 창호"임을 명시하고, 절감 계산 대신 추가 개선 여지가 제한적임을 안내하세요.`;
    }
    const lines = data.dbProducts.slice(0, 3).map((p, i) => {
      // ★ parseFloat으로 반드시 숫자 변환 (DB에서 문자열로 올 수 있음)
      const uTarget = parseFloat(String(p.열관류율));
      if (isNaN(uTarget) || uTarget >= data.uValue) return null; // 비정상값 건너뜀
      // ★ /1000으로 Wh→kWh 단위 변환
      const savings = (data.uValue - uTarget) * data.area * hdd * 24 / 1000;
      const co2 = savings * 0.4599;
      return `  ${i + 1}. ${p.모델명 || '인증제품'} | Uw=${uTarget} W/m²·K | 효율등급 ${p.효율등급 || '-'}등급\n     절감량(공식계산): (${data.uValue} - ${uTarget}) × ${data.area} × ${hdd} × 24 / 1000 = ${savings.toFixed(0)} kWh/년, CO2 = ${co2.toFixed(0)} kg/년`;
    }).filter(Boolean);
    return `
[DB 개선 후보 제품] (현재 Uw ${data.uValue}보다 낮은 실제 인증 제품, 열관류율 오름차순)
${lines.join('\n')}
위 절감량은 공식(÷1000으로 kWh 변환)으로 미리 계산된 값입니다. 반드시 이 수치를 strategicImprovements의 energySavingsKwh, co2ReductionKg에 사용하세요.`;
  })();

  const fullUserPrompt = userPrompt + productsPromptSection;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: fullUserPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('[Claude] API 에러:', response.status, errorBody);
    throw new Error(`Claude API 호출 실패 (${response.status}): ${errorBody}`);
  }

  const result = await response.json();
  const textContent = result.content?.[0]?.text;

  if (!textContent) {
    throw new Error('Claude API 응답에 텍스트 콘텐츠가 없습니다.');
  }

  // JSON 파싱 (코드 블록이 포함되어 있으면 제거하고 순수 JSON만 추출)
  const clean = textContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    const parsed: ClaudeAnalysisResult = JSON.parse(clean);
    console.log('[Claude] 분석 완료:', {
      strategiesCount: parsed.strategicImprovements?.length,
      energySavings: parsed.energySavingsKwh,
      co2Reduction: parsed.co2ReductionKg,
    });
    return parsed;
  } catch (parseErr) {
    console.error('[Claude] JSON 파싱 실패:', parseErr, '\n원본:', textContent);
    throw new Error('Claude 응답 JSON 파싱에 실패했습니다.');
  }
}

export async function getClaudeChatbotResponse(
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> {
  const chatbotSystemPrompt = `당신은 창호 성능 전문 AI 어시스턴트인 "WINI"(위니)입니다.
다음 세 가지 역할을 합니다:
1. 입력값 도우미: U-value, SHGC, 기밀성, TDR 등 
   입력 방법을 모르는 사용자에게 쉽게 설명
2. 창호 Q&A: 창호 성능, 에너지절약설계기준, 
   효율등급에 관한 전문 질문 답변
3. FAQ: 자주 묻는 질문 자동 안내
항상 한국어로 답변하고 전문적이되 쉽게 설명해주세요.
에너지공단 인증 창세트 DB 19,485건 기반 서비스임을 인지하세요.

[중요 지침 - 가독성 및 톤앤매너]
- 절대 답변에 마크다운 기호(예: #, ##, ***, **, ---, >, * 등)를 사용하지 마세요.
- 제목이나 강조를 하고 싶다면 마크다운 기호 없이 일반 텍스트 줄바꿈과 공백으로 간격을 띄우고, 문장 앞에 일반 기호(예: [기본 개념], •, 1., 2. 등)를 사용하여 정돈되게 답변하세요.
- AI 답변 티가 나지 않도록 실제 메신저로 친절한 전문가(이름: WINI)와 대화하는 듯한 구어체 톤으로 답변을 자연스럽게 제공해주세요.`;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: chatbotSystemPrompt,
      messages: messages,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('[Claude Chatbot] API 에러:', response.status, errorBody);
    throw new Error(`Claude Chatbot API 호출 실패 (${response.status}): ${errorBody}`);
  }

  const result = await response.json();
  const textContent = result.content?.[0]?.text;

  if (!textContent) {
    throw new Error('Claude API 응답에 텍스트 콘텐츠가 없습니다.');
  }

  return textContent;
}

