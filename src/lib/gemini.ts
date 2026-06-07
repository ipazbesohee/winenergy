import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface StrategicImprovement {
  title: string;
  description: string;
  energySavingsKwh: number;
  co2ReductionKg: number;
}

export interface AIAnalysisResult {
  summary: string;
  detailedAnalysis: string;
  strategicImprovements: StrategicImprovement[];
  economicImpact: string;
  energySavingsKwh: number;
  co2ReductionKg: number;
}

export async function getAIWindowAnalysis(data: any): Promise<AIAnalysisResult> {
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

  const prompt = `
    당신은 건물 에너지 효율 전문가입니다. 다음 창호 성능 데이터를 분석하고 전문적인 진단 보고서를 작성해주세요.
    
    [입력 데이터]
    - 지역: ${data.regionName}
    - 건물 용도: ${buildingLabel}
    - 외기 접촉 여부: ${contactLabel}
    - 열관류율 (U-value): ${data.uValue} W/m²·K
    - 일사열취득률 (SHGC): ${data.shgc} (참고값)
    - 기밀성 등급: ${data.airtight}등급
    - 결로방지성능 (TDR): ${data.tdr}
    - 창호 면적: ${data.area} m²
    
    [분석 요청 사항]
    1. 현재 성능에 대한 종합 요약 (전문적이고 신뢰감 있는 톤)
    2. 각 지표별 심층 분석 (에너지 손실 관점에서 U-value, SHGC(참고용), 기밀성, TDR 각각 분석)
    3. 구체적이고 실현 가능한 개선 전략 (최소 3가지). 각 전략별로 예상되는 연간 에너지 절감량(kWh)과 CO2 저감량(kg)을 포함해야 합니다. 전략 제목(title)은 차트 표시를 위해 10자 내외로 간결하게 작성해주세요.
    4. 개선 시 예상되는 경제적/환경적 효과 (정성적 분석)
    5. 제안된 모든 개선안 적용 시 총 연간 예상 에너지 절감량 (kWh/year) 및 CO2 저감량 (kg/year) 수치 추정
    
    한국어로 답변해주세요.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          detailedAnalysis: { type: Type.STRING },
          strategicImprovements: {
            type: Type.ARRAY,
            items: { 
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                energySavingsKwh: { type: Type.NUMBER },
                co2ReductionKg: { type: Type.NUMBER }
              },
              required: ["title", "description", "energySavingsKwh", "co2ReductionKg"]
            }
          },
          economicImpact: { type: Type.STRING },
          energySavingsKwh: { type: Type.NUMBER, description: "Total estimated annual energy savings in kWh" },
          co2ReductionKg: { type: Type.NUMBER, description: "Total estimated annual CO2 reduction in kg" }
        },
        required: ["summary", "detailedAnalysis", "strategicImprovements", "economicImpact", "energySavingsKwh", "co2ReductionKg"]
      }
    }
  });

  return JSON.parse(response.text);
}
