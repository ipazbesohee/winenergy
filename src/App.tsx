/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Activity, 
  AlertTriangle, 
  ArrowRight, 
  BarChart3, 
  CheckCircle2, 
  ChevronRight, 
  ChevronDown,
  Database, 
  Download, 
  Info, 
  LayoutDashboard, 
  Lightbulb, 
  Plus, 
  RefreshCcw, 
  Search, 
  Settings2, 
  Sparkles, 
  Thermometer, 
  TrendingUp,
  Wind,
  XCircle,
  Sun,
  Moon,
  MessageSquare,
  Send,
  X,
  Loader2
} from "lucide-react";
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend
} from "recharts";
import { cn } from "@/src/lib/utils";
import { getClaudeWindowAnalysis, getClaudeChatbotResponse, type ClaudeAnalysisResult } from "@/src/lib/claude";
import { getProductsByUValue, getProductStats } from "@/src/lib/supabase";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas-pro";

// --- Constants & Types ---

const REGIONS = {
  central1: { name: "강원 산간 (태백, 정선 등)" },
  central2: { name: "서울, 인천, 경기도 (기본값)" },
  south: { name: "부산, 대구, 광주 등" },
  jeju: { name: "제주도" },
};

const REGION_U_LIMITS: Record<string, number> = {
  central1: 0.9,
  central2: 1.0,
  south: 1.2,
  jeju: 1.6,
};

const BUILDING_TYPES = [
  { value: "residential_apartment", label: "주거 (공동주택)" },
  { value: "residential_single", label: "주거 (단독주택)" },
  { value: "non_residential", label: "비주거" }
];

const CONTACT_TYPES = [
  { value: "direct", label: "외기직접" },
  { value: "indirect", label: "외기간접" }
];

// U-value thresholds mapping: [buildingType][contactType][region]
const U_VALUE_THRESHOLDS: Record<string, Record<string, Record<string, number>>> = {
  residential_apartment: {
    direct: { central1: 0.9, central2: 1.0, south: 1.2, jeju: 1.6 },
    indirect: { central1: 1.35, central2: 1.5, south: 1.8, jeju: 2.4 }
  },
  residential_single: {
    direct: { central1: 0.9, central2: 1.0, south: 1.2, jeju: 1.6 },
    indirect: { central1: 1.35, central2: 1.5, south: 1.8, jeju: 2.4 }
  },
  non_residential: {
    direct: { central1: 1.3, central2: 1.5, south: 1.8, jeju: 2.2 },
    indirect: { central1: 1.95, central2: 2.25, south: 2.7, jeju: 3.3 }
  }
};

// TDR thresholds mapping by region
const TDR_THRESHOLDS: Record<string, number> = {
  central1: 0.25,
  central2: 0.25,
  south: 0.28,
  jeju: 0.30
};

const AIRTIGHT_GRADES=[1,2,3,4];
const FRAME_TYPES=["all","AL","PVC","AL_PVC","WOOD","WOOD_AL"];
const FRAME_LABELS: Record<string, string> = {all:"전체",AL:"알루미늄",PVC:"PVC",AL_PVC:"복합(AL+PVC)",WOOD:"목재",WOOD_AL:"복합(목재+AL)"};

// --- CountUp Component ---
function CountUp({ end, duration = 1000, prefix = "", suffix = "" }: { end: number; duration?: number; prefix?: string; suffix?: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let startTimestamp: number | null = null;
    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      setCount(Math.floor(progress * end));
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  }, [end, duration]);
  return <span>{prefix}{count.toLocaleString()}{suffix}</span>;
}

// --- Highlight important keywords in analysis text ---
const HIGHLIGHT_KEYWORDS = [
  // Performance metrics
  /\d+(\.\d+)?\s*(W\/m[²2]K|kWh|kg|%|만\s*원|원)/g,
  // Grade references
  /[1-5]\s*등급/g,
  // Key technical terms
  /(열관류율|SHGC|기밀성|TDR|U-value|Low-E|로이|삼중유리|복층유리|아르곤)/g,
  // Judgment phrases  
  /(기준\s*(미달|만족|초과|이하|이상))/g,
  /(개선\s*(필요|권장|가능|효과)|절감|감축|위험|취약|우수|양호|적합|부적합|필수)/g,
];

function HighlightText({ text, className, style }: { text: string; className?: string; style?: any }) {
  if (!text) return null;
  
  const parts: { text: string; highlight: boolean }[] = [];
  let remaining = text;
  
  // Collect all matches with positions
  const allMatches: { start: number; end: number }[] = [];
  for (const pattern of HIGHLIGHT_KEYWORDS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      allMatches.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  
  // Sort and merge overlapping
  allMatches.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const m of allMatches) {
    if (merged.length > 0 && m.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, m.end);
    } else {
      merged.push({ ...m });
    }
  }
  
  // Build parts
  let cursor = 0;
  for (const m of merged) {
    if (cursor < m.start) {
      parts.push({ text: text.slice(cursor, m.start), highlight: false });
    }
    parts.push({ text: text.slice(m.start, m.end), highlight: true });
    cursor = m.end;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), highlight: false });
  }
  
  return (
    <p className={className} style={style}>
      {parts.map((part, i) =>
        part.highlight ? (
          <mark key={i} className="bg-yellow-200/80 dark:bg-yellow-500/35 text-slate-900 dark:text-yellow-100 rounded px-0.5 font-semibold" style={{ textDecoration: 'none' }}>{part.text}</mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </p>
  );
}
function TypingText({ 
  text, 
  delay = 0, 
  className = "", 
  hideCursor = false, 
  onComplete 
}: { 
  text: string; 
  delay?: number; 
  className?: string; 
  hideCursor?: boolean; 
  onComplete?: () => void 
}) {
  const [displayedText, setDisplayedText] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    setDisplayedText("");
    setIsComplete(false);

    let timeoutId: NodeJS.Timeout;
    let intervalId: NodeJS.Timeout;
    
    timeoutId = setTimeout(() => {
      let currentLength = 0;
      intervalId = setInterval(() => {
        currentLength++;
        setDisplayedText(text.slice(0, currentLength));
        if (currentLength >= text.length) {
          clearInterval(intervalId);
          setIsComplete(true);
          if (onCompleteRef.current) {
            onCompleteRef.current();
          }
        }
      }, 40); // typing speed
    }, delay);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [text, delay]);

  return (
    <span className={className}>
      {displayedText}
      {!isComplete && !hideCursor && (
        <span className="inline-block w-[3px] h-[1.1em] bg-blue-500 ml-1 align-middle animate-pulse" />
      )}
    </span>
  );
}

interface LightStreak {
  x: number;
  y: number;
  length: number;
  speed: number;
  opacity: number;
  opacityDir: number;
  width: number;
}

function HeroCanvasBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Mouse tracking — smooth lerp
    let mouseX = width / 2;
    let mouseY = height / 2;
    let targetMouseX = width / 2;
    let targetMouseY = height / 2;
    // Glow radius animation
    let glowPulse = 0;

    const handleMouseMove = (e: MouseEvent) => {
      targetMouseX = e.clientX;
      targetMouseY = e.clientY;
    };

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("resize", handleResize);

    // --- Light streaks: slow downward flowing lines ---
    const STREAK_COUNT = 13;
    const streaks: LightStreak[] = [];

    const createStreak = (initialY?: number): LightStreak => ({
      x: Math.random() * width,
      y: initialY ?? -Math.random() * height,       // spawn above screen
      length: Math.random() * 120 + 60,              // 60–180px
      speed: Math.random() * 0.5 + 0.2,              // very slow: 0.2–0.7 px/frame
      opacity: Math.random() * 0.3 + 0.15,           // 0.15–0.45
      opacityDir: (Math.random() > 0.5 ? 1 : -1) * 0.003,
      width: 1,
    });

    for (let i = 0; i < STREAK_COUNT; i++) {
      streaks.push(createStreak(Math.random() * height)); // staggered initial y
    }

    // ---- Render loop ----
    const render = () => {
      // Smooth mouse
      mouseX += (targetMouseX - mouseX) * 0.06;
      mouseY += (targetMouseY - mouseY) * 0.06;
      glowPulse = (glowPulse + 0.02) % (Math.PI * 2);

      ctx.clearRect(0, 0, width, height);

      // ===== 1. GRID (parallax, very faint) =====
      const gridSpacing = 60;
      const offsetX = ((mouseX - width / 2) * 0.018) % gridSpacing;
      const offsetY = ((mouseY - height / 2) * 0.018) % gridSpacing;

      ctx.save();
      ctx.strokeStyle = "rgba(0, 255, 136, 0.055)";
      ctx.lineWidth = 0.5;

      for (let x = offsetX - gridSpacing; x < width + gridSpacing; x += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = offsetY - gridSpacing; y < height + gridSpacing; y += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Grid intersection dots
      ctx.fillStyle = "rgba(0, 255, 136, 0.1)";
      for (let x = offsetX - gridSpacing; x < width + gridSpacing; x += gridSpacing) {
        for (let y = offsetY - gridSpacing; y < height + gridSpacing; y += gridSpacing) {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      // ===== 2. LIGHT STREAKS (downward flowing) =====
      streaks.forEach((s) => {
        // Move down
        s.y += s.speed;

        // Fade in/out
        s.opacity += s.opacityDir;
        if (s.opacity > 0.45) { s.opacity = 0.45; s.opacityDir = -s.opacityDir; }
        if (s.opacity < 0.08) { s.opacity = 0.08; s.opacityDir = -s.opacityDir; }

        // Respawn at top when fully past bottom
        if (s.y - s.length > height) {
          s.x = Math.random() * width;
          s.y = -s.length;
          s.length = Math.random() * 120 + 60;
          s.speed = Math.random() * 0.5 + 0.2;
        }

        // Draw gradient streak (fade top → bright middle → fade bottom)
        const grad = ctx.createLinearGradient(s.x, s.y - s.length, s.x, s.y);
        grad.addColorStop(0, `rgba(0, 255, 136, 0)`);
        grad.addColorStop(0.3, `rgba(0, 255, 136, ${s.opacity * 0.6})`);
        grad.addColorStop(0.7, `rgba(0, 220, 120, ${s.opacity})`);
        grad.addColorStop(1, `rgba(0, 180, 100, 0)`);

        ctx.save();
        ctx.strokeStyle = grad;
        ctx.lineWidth = s.width;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - s.length);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        ctx.restore();
      });

      // ===== 3. MOUSE GLOW =====
      const glowRadius = 260 + Math.sin(glowPulse) * 30; // enlarged + breathing
      const glowGrad = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, glowRadius);
      glowGrad.addColorStop(0,   "rgba(0, 255, 136, 0.18)");
      glowGrad.addColorStop(0.3, "rgba(0, 255, 136, 0.10)");
      glowGrad.addColorStop(0.6, "rgba(0, 200, 100, 0.04)");
      glowGrad.addColorStop(1,   "rgba(0, 255, 136, 0)");

      ctx.save();
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(mouseX, mouseY, glowRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full z-0 pointer-events-none" />;
}

// --- Helper Components ---

const Card = ({ title, icon: _Icon, children, className }: any) => (
  <div className={cn(
    "rounded-xl p-5 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg",
    className
  )} style={{ backgroundColor: "var(--color-card)", border: "1px solid var(--color-card-border)" }}>
    {title && (
      <div className="mb-4">
        <h3 className="text-lg font-bold" style={{ color: "var(--color-text)" }}>{title}</h3>
      </div>
    )}
    {children}
  </div>
);

const InputField = ({ label, value, onChange, type = "number", ...props }: any) => (
  <div className="space-y-1.5">
    <label className="text-xs font-semibold uppercase tracking-tight" style={{ color: "var(--color-text-sub)" }}>{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40 transition-all" style={{ backgroundColor: "var(--color-bg)", border: "1px solid var(--color-card-border)", color: "var(--color-text)" }}
      {...props}
    />
  </div>
);

const SelectField = ({ label, value, onChange, options }: any) => (
  <div className="space-y-1.5">
    <label className="text-xs font-semibold uppercase tracking-tight" style={{ color: "var(--color-text-sub)" }}>{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40 transition-all cursor-pointer appearance-none" style={{ backgroundColor: "var(--color-bg)", border: "1px solid var(--color-card-border)", color: "var(--color-text)" }}
    >
      {options.map((opt: any) => (
        <option key={opt.value} value={opt.value} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">{opt.label}</option>
      ))}
    </select>
  </div>
);

// --- Stats Tab Component ---

const STAT_COLORS_LIGHT = ['#2563EB', '#60A5FA', '#BFDBFE', '#93C5FD', '#3B82F6', '#1D4ED8', '#2563EB', '#60A5FA'];
const STAT_COLORS_DARK = ['#00FF88', '#00CC70', '#008F4E', '#00E67A', '#00FF88', '#00B35E', '#00FF88', '#00CC70'];
const PIE_COLORS_GLASS = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b'];
const PIE_COLORS_LOWE = ['#10b981', '#64748b'];

// --- Box Plot Custom Components ---

const BoxPlotBar = (props: any) => {
  const { x, y, width, height, payload, yScale, fill, stroke } = props;
  if (!payload) return null;

  const [q1, q3] = payload.boxRange;
  const scaleY = yScale || ((val: number) => {
    if (q3 === q1) return y;
    return y + (q3 - val) * (height / (q3 - q1));
  });

  const xCenter = x + width / 2;
  const yMin = scaleY(payload.min);
  const yQ1 = scaleY(payload.q1);
  const yMedian = scaleY(payload.median);
  const yQ3 = scaleY(payload.q3);
  const yMax = scaleY(payload.max);

  const boxColor = fill || "#3b82f6";
  const strokeColor = stroke || "#1e293b";

  return (
    <g>
      {/* Vertical Whisker Lines */}
      <line x1={xCenter} y1={yMin} x2={xCenter} y2={yQ1} stroke={strokeColor} strokeWidth={1.5} />
      <line x1={xCenter} y1={yMax} x2={xCenter} y2={yQ3} stroke={strokeColor} strokeWidth={1.5} />

      {/* Whisker Caps */}
      <line x1={xCenter - 8} y1={yMin} x2={xCenter + 8} y2={yMin} stroke={strokeColor} strokeWidth={1.5} />
      <line x1={xCenter - 8} y1={yMax} x2={xCenter + 8} y2={yMax} stroke={strokeColor} strokeWidth={1.5} />

      {/* Box (Q1 to Q3) */}
      <rect 
        x={x} 
        y={yQ3} 
        width={width} 
        height={Math.max(0, yQ1 - yQ3)} 
        fill={boxColor} 
        fillOpacity={0.65}
        stroke={strokeColor} 
        strokeWidth={1.5} 
        rx={2}
      />

      {/* Median Line */}
      <line x1={x} y1={yMedian} x2={x + width} y2={yMedian} stroke="#ef4444" strokeWidth={2} />
    </g>
  );
};

const BoxPlotTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 rounded-lg shadow-lg text-xs space-y-1 text-slate-800 dark:text-slate-200">
        <p className="font-black text-xs text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-1 mb-1">{data.name}</p>
        <div className="space-y-0.5">
          <p><span className="text-slate-400 font-semibold">최댓값 (Max):</span> <span className="font-bold">{data.max.toFixed(2)} W/m²K</span></p>
          <p><span className="text-slate-400 font-semibold">3사분위 (Q3):</span> <span className="font-bold">{data.q3.toFixed(2)} W/m²K</span></p>
          <p><span className="text-slate-400 font-semibold">중앙값 (Median):</span> <span className="font-bold text-red-500">{data.median.toFixed(2)} W/m²K</span></p>
          <p><span className="text-slate-400 font-semibold">1사분위 (Q1):</span> <span className="font-bold">{data.q1.toFixed(2)} W/m²K</span></p>
          <p><span className="text-slate-400 font-semibold">최솟값 (Min):</span> <span className="font-bold">{data.min.toFixed(2)} W/m²K</span></p>
        </div>
      </div>
    );
  }
  return null;
};

function StatsTab({ isDarkMode }: { isDarkMode: boolean }) {
  const [glassType, setGlassType] = useState<"single" | "double" | "triple">("triple");
  const [isHovered, setIsHovered] = useState(false);

  const simulatorSpecs = useMemo(() => {
    switch (glassType) {
      case "single":
        return {
          uValue: "5.8",
          status: "DANGER",
          statusLabel: "Danger (기준미달)",
          statusClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 animate-pulse",
          comfortClass: "bg-rose-500/10 dark:bg-rose-500/20 border-rose-500/20 dark:border-rose-500/30 text-rose-500 animate-pulse",
          achieveText: "기준 미달 (4.8 초과)",
          achieveClass: "text-rose-500 dark:text-rose-400 font-extrabold uppercase tracking-tight",
          barWidth: "15%",
          barClass: "bg-rose-500",
        };
      case "double":
        return {
          uValue: "1.2",
          status: "WARNING",
          statusLabel: "Warning (기준미달)",
          statusClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 animate-pulse",
          comfortClass: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
          achieveText: "기준 미달 (0.2 초과)",
          achieveClass: "text-amber-500 dark:text-amber-400 font-extrabold uppercase tracking-tight",
          barWidth: "75%",
          barClass: "bg-amber-500",
        };
      case "triple":
      default:
        return {
          uValue: "0.7",
          status: "SUCCESS",
          statusLabel: "Optimal (기준만족)",
          statusClass: "bg-emerald-500/10 text-emerald-650 dark:text-emerald-400 border border-emerald-500/20 animate-pulse",
          comfortClass: "bg-emerald-500/10 dark:bg-emerald-500/20 border-emerald-500/20 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400 animate-pulse",
          achieveText: "기준 만족 (0.3 단축)",
          achieveClass: "text-emerald-600 dark:text-emerald-400 font-extrabold uppercase tracking-tight",
          barWidth: "95%",
          barClass: "bg-emerald-500",
        };
    }
  }, [glassType]);

  const [statsData, setStatsData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    if (hasFetched) return;
    const fetchStats = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await getProductStats();
        setStatsData(data);
        setHasFetched(true);
      } catch (err: any) {
        setError(err.message || '통계 데이터를 불러오는데 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchStats();
  }, [hasFetched]);

  // --- 데이터 가공 ---
  const summaryStats = useMemo(() => {
    if (statsData.length === 0) return { total: 0, grade1Ratio: 0, avgUValue: 0, loweRatio: 0 };
    const total = statsData.length;
    let grade1Count = 0;
    let uValueSum = 0;
    let uValueCount = 0;
    let loweCount = 0;

    statsData.forEach((p) => {
      if (p.효율등급 === 1) grade1Count++;
      if (typeof p.열관류율 === 'number') {
        uValueSum += p.열관류율;
        uValueCount++;
      }
      if (p.로이여부 === true || p.로이여부 === 'true' || p.로이여부 === 1) loweCount++;
    });

    return {
      total,
      grade1Ratio: total > 0 ? parseFloat(((grade1Count / total) * 100).toFixed(1)) : 0,
      avgUValue: uValueCount > 0 ? parseFloat((uValueSum / uValueCount).toFixed(2)) : 0,
      loweRatio: total > 0 ? parseFloat(((loweCount / total) * 100).toFixed(1)) : 0
    };
  }, [statsData]);

  const boxPlotData = useMemo(() => {
    const getPercentile = (arr: number[], pct: number) => {
      if (arr.length === 0) return 0;
      const index = pct * (arr.length - 1);
      const lower = Math.floor(index);
      const upper = Math.ceil(index);
      const weight = index - lower;
      return arr[lower] * (1 - weight) + arr[upper] * weight;
    };

    return [1, 2, 3, 4, 5].map((grade) => {
      const values = statsData
        .filter(p => p.효율등급 === grade && typeof p.열관류율 === 'number')
        .map(p => p.열관류율)
        .sort((a, b) => a - b);

      if (values.length === 0) {
        return {
          name: `${grade}등급`,
          min: 0,
          q1: 0,
          median: 0,
          q3: 0,
          max: 0,
          boxRange: [0, 0]
        };
      }

      const min = values[0];
      const q1 = getPercentile(values, 0.25);
      const median = getPercentile(values, 0.50);
      const q3 = getPercentile(values, 0.75);
      const max = values[values.length - 1];

      return {
        name: `${grade}등급`,
        min,
        q1,
        median,
        q3,
        max,
        boxRange: [q1, q3]
      };
    });
  }, [statsData]);

  const frameGradeDistribution = useMemo(() => {
    const frameLabels: Record<string, string> = {
      "AL": "알루미늄",
      "PVC": "PVC",
      "AL_PVC": "복합(AL+PVC)",
      "WOOD": "목재",
      "WOOD_AL": "복합(목재+AL)"
    };

    const counts: Record<string, Record<number, number>> = {};
    const frameTypes = ["AL", "PVC", "AL_PVC", "WOOD", "WOOD_AL"];
    frameTypes.forEach(ft => {
      const label = frameLabels[ft] || ft;
      counts[label] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    });

    statsData.forEach((p) => {
      let frame = p.프레임재질 || '기타';
      if (frameLabels[frame]) {
        frame = frameLabels[frame];
      }
      const g = p.효율등급;
      if (g >= 1 && g <= 5) {
        if (!counts[frame]) {
          counts[frame] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        }
        counts[frame][g]++;
      }
    });

    return Object.entries(counts).map(([name, grades]) => ({
      name,
      "1등급": grades[1],
      "2등급": grades[2],
      "3등급": grades[3],
      "4등급": grades[4],
      "5등급": grades[5],
    }));
  }, [statsData]);

  const comboUValueData = useMemo(() => {
    const sums: Record<string, { sum: number; count: number }> = {
      "복층 × 로이있음": { sum: 0, count: 0 },
      "복층 × 로이없음": { sum: 0, count: 0 },
      "삼중 × 로이있음": { sum: 0, count: 0 },
      "삼중 × 로이없음": { sum: 0, count: 0 },
    };

    statsData.forEach((p) => {
      const u = p.열관류율;
      if (typeof u !== 'number') return;

      const glass = p.유리구성 || '';
      const isLowe = p.로이여부 === true || p.로이여부 === 'true' || p.로이여부 === 1;

      let glassCat = "";
      if (glass.includes("복층") || glass.includes("이중") || glass.includes("2중")) {
        glassCat = "복층";
      } else if (glass.includes("삼중") || glass.includes("3중")) {
        glassCat = "삼중";
      } else {
        return; // Skip other configurations
      }

      const key = `${glassCat} × 로이${isLowe ? "있음" : "없음"}`;
      if (sums[key]) {
        sums[key].sum += u;
        sums[key].count++;
      }
    });

    return Object.entries(sums)
      .map(([name, data]) => ({
        name,
        avgUValue: data.count > 0 ? parseFloat((data.sum / data.count).toFixed(3)) : 0,
        count: data.count
      }))
      .filter(item => item.count > 0);
  }, [statsData]);

  const topCompaniesData = useMemo(() => {
    const counts: Record<string, number> = {};
    statsData.forEach((p) => {
      const company = p.업체명 || p.업체명 || p.manufacturer || '기타';
      if (company === '기타' || company === '-') return;
      counts[company] = (counts[company] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [statsData]);

  const totalProducts = statsData.length;

  if (isLoading) {
    return (
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }}
        className="space-y-6"
      >
        {/* Header Skeleton */}
        <div className="flex items-center justify-between">
          <div className="h-6 w-48 bg-slate-200 dark:bg-slate-800 rounded-md animate-pulse" />
          <div className="h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded-md animate-pulse" />
        </div>

        {/* 4 Summary Cards Skeletons */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div 
              key={idx} 
              className="p-5 bg-white dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center justify-between shadow-sm animate-pulse"
            >
              <div className="space-y-2.5">
                <div className="h-3 w-16 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-6 w-24 bg-slate-200 dark:bg-slate-800 rounded-md" />
              </div>
              <div className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-800" />
            </div>
          ))}
        </div>

        {/* Simulator Skeleton */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-6 bg-white dark:bg-slate-900/10 flex flex-col md:flex-row gap-8 items-stretch animate-pulse">
          <div className="flex-1 min-h-[300px] border border-slate-200 dark:border-slate-800 rounded-xl p-5 bg-slate-50 dark:bg-slate-950 flex flex-col justify-between" />
          <div className="w-full md:w-[260px] h-[300px] bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800" />
        </div>

        {/* Charts Grid Skeletons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div 
              key={idx} 
              className="border border-slate-200 dark:border-slate-800 rounded-2xl p-5 bg-white dark:bg-slate-900/10 space-y-4 animate-pulse"
            >
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-lg bg-slate-200 dark:bg-slate-800" />
                <div className="h-4 w-36 bg-slate-200 dark:bg-slate-800 rounded" />
              </div>
              <div className="h-[260px] w-full bg-slate-50 dark:bg-slate-950 rounded-xl flex flex-col justify-end p-4 space-y-3">
                <div className="w-full h-1/3 bg-slate-200/50 dark:bg-slate-800/30 rounded-md" />
                <div className="w-full h-1/2 bg-slate-200/50 dark:bg-slate-800/30 rounded-md" />
                <div className="w-full h-1/4 bg-slate-200/50 dark:bg-slate-800/30 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="py-16 text-center bg-rose-500/5 border border-rose-200 dark:border-rose-500/20 rounded-2xl shadow-sm">
          <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto mb-4" />
          <p className="text-rose-600 dark:text-rose-400 font-bold mb-2">통계 데이터를 불러올 수 없습니다</p>
          <p className="text-xs text-slate-500">{error}</p>
          <button
            onClick={() => setHasFetched(false)}
            className="mt-4 px-6 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
          >
            다시 시도
          </button>
        </div>
      </motion.div>
    );
  }

  // 테마별 색상 설정
  const tickColor = isDarkMode ? '#94a3b8' : '#64748b';
  const chartColors = isDarkMode ? STAT_COLORS_DARK : STAT_COLORS_LIGHT;
  const gridColor = isDarkMode ? '#1e293b' : '#f1f5f9';
  const tooltipBg = isDarkMode ? '#0A0F1E' : '#FFFFFF';
  const tooltipBorder = isDarkMode ? '#1F2937' : '#E2E8F0';
  const tooltipColor = isDarkMode ? '#F1F5F9' : '#0F172A';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--color-text)" }}>
          
          제품 통계 대시보드
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold" style={{ color: "var(--color-text-sub)" }}>
            총 <CountUp end={totalProducts} />개 제품 분석
          </span>
          <button
            onClick={() => setHasFetched(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold transition-all cursor-pointer shadow-sm"
          >
            <RefreshCcw className="w-3 h-3" />
            새로고침
          </button>
        </div>
      </div>

      {/* 4 Summary Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Card 1: 총 인증 제품 수 */}
        <div className="p-5 rounded-2xl flex items-center justify-between shadow-sm transition-all duration-300" style={{ backgroundColor: "var(--color-card)", border: "1px solid var(--color-card-border)" }}>
          <div className="space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-text-sub)" }}>총 인증 제품 수</span>
            <div className="text-xl font-black" style={{ color: "var(--color-text)" }}>
              <CountUp end={summaryStats.total} suffix="개" />
            </div>
          </div>
          
        </div>

        {/* Card 2: 1등급 제품 비율 */}
        <div className="p-5 rounded-2xl flex items-center justify-between shadow-sm transition-all duration-300" style={{ backgroundColor: "var(--color-card)", border: "1px solid var(--color-card-border)" }}>
          <div className="space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-text-sub)" }}>1등급 제품 비율</span>
            <div className="text-xl font-black" style={{ color: "var(--color-primary)" }}>
              <CountUp end={summaryStats.grade1Ratio} decimals={1} suffix="%" />
            </div>
          </div>
          
        </div>

        {/* Card 3: 평균 U-value */}
        <div className="p-5 rounded-2xl flex items-center justify-between shadow-sm transition-all duration-300" style={{ backgroundColor: "var(--color-card)", border: "1px solid var(--color-card-border)" }}>
          <div className="space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-text-sub)" }}>평균 열관류율</span>
            <div className="text-xl font-black" style={{ color: "var(--color-primary)" }}>
              <CountUp end={summaryStats.avgUValue} decimals={2} suffix=" W/m²K" />
            </div>
          </div>
          
        </div>

        {/* Card 4: 로이 적용 비율 */}
        <div className="p-5 rounded-2xl flex items-center justify-between shadow-sm transition-all duration-300" style={{ backgroundColor: "var(--color-card)", border: "1px solid var(--color-card-border)" }}>
          <div className="space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-text-sub)" }}>로이 적용 비율</span>
            <div className="text-xl font-black" style={{ color: "var(--color-primary)" }}>
              <CountUp end={summaryStats.loweRatio} decimals={1} suffix="%" />
            </div>
          </div>
          
        </div>
      </div>

      {/* 실시간 창호 단열 성능 비교 시뮬레이터 */}
      <div className={cn(
        "border rounded-2xl p-6 shadow-sm relative overflow-hidden flex flex-col md:flex-row gap-8 items-stretch transition-all duration-300",
        isDarkMode ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-slate-200"
      )}>
        {/* Left pane: Simulator Visuals */}
        <div className={cn(
          "flex-1 min-h-[300px] border rounded-xl p-5 flex flex-col justify-between relative overflow-hidden transition-all duration-300",
          isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-50 border-slate-200 text-slate-800"
        )}>
          {/* Header */}
          <div className={cn(
            "relative z-10 flex items-center justify-between border-b pb-3 mb-4 transition-colors",
            isDarkMode ? "border-slate-800/60" : "border-slate-200"
          )}>
            <div>
              <h4 className={cn(
                "text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors",
                isDarkMode ? "text-slate-400" : "text-slate-600"
              )}>
                <Activity className={cn("w-3.5 h-3.5", isDarkMode ? "text-blue-400" : "text-blue-600")} />
                단열 성능 시뮬레이터
              </h4>
              <p className={cn(
                "text-[10px] mt-0.5 transition-colors",
                isDarkMode ? "text-slate-500" : "text-slate-400"
              )}>유리 단면 사양에 따른 가상 에너지 대류 실험</p>
            </div>
            <div className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${simulatorSpecs.statusClass}`}>
              {simulatorSpecs.statusLabel}
            </div>
          </div>

          {/* Switcher */}
          <div className={cn(
            "relative z-10 grid grid-cols-3 gap-1 p-1 rounded-lg border mb-4 transition-all duration-300",
            isDarkMode ? "bg-slate-900/80 border-slate-800" : "bg-slate-200/50 border-slate-200/70"
          )}>
            {(["single", "double", "triple"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setGlassType(t)}
                className={cn(
                  "py-1 rounded text-[10px] sm:text-xs font-bold transition-all cursor-pointer",
                  glassType === t 
                    ? "bg-blue-600 text-white shadow-md shadow-blue-500/20" 
                    : isDarkMode 
                      ? "text-slate-400 hover:text-white" 
                      : "text-slate-600 hover:text-slate-800"
                )}
              >
                {t === "single" ? "단층 일반" : t === "double" ? "이중 로이" : "삼중 아르곤"}
              </button>
            ))}
          </div>

          {/* Canvas */}
          <div 
            className={cn(
              "relative flex-1 min-h-[160px] border rounded-lg p-3 flex items-center justify-between overflow-hidden transition-all duration-300",
              isDarkMode 
                ? "bg-slate-950/40 border-slate-800/60" 
                : "bg-white border-slate-200/60 shadow-inner"
            )}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            {/* Solar Heat */}
            <div className="flex flex-col items-center gap-1 z-10">
              <div className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center animate-sun-glow">
                <Thermometer className="w-4 h-4 text-red-500" />
              </div>
              <span className={cn(
                "text-[7px] font-bold uppercase tracking-wider transition-colors",
                isDarkMode ? "text-red-400" : "text-red-650"
              )}>실외 열기</span>
            </div>

            {/* 3D Glass model */}
            <div className="relative flex-1 h-full flex items-center justify-center pointer-events-none" style={{ perspective: '800px' }}>
              <motion.div 
                animate={{ 
                  rotateY: isHovered ? -20 : -10,
                  rotateX: isHovered ? 10 : 5,
                }}
                transition={{ type: "spring", stiffness: 100, damping: 20 }}
                className="relative w-24 h-28 flex items-center justify-center"
              >
                {/* 1st Glass */}
                <motion.div 
                  animate={{ 
                    x: isHovered ? -35 : -12,
                    z: isHovered ? 40 : 15,
                    opacity: 0.8
                  }}
                  className={cn(
                    "absolute w-5 h-24 border-2 rounded backdrop-blur-[1px] flex flex-col justify-between items-center py-2 transition-all duration-300",
                    isDarkMode 
                      ? "bg-blue-300/10 border-blue-400/40" 
                      : "bg-blue-500/5 border-blue-400/30"
                  )}
                >
                  <div className={cn("w-0.5 h-1/3 rounded-full transition-colors", isDarkMode ? "bg-white/20" : "bg-blue-500/20")} />
                  <span className={cn(
                    "text-[6px] font-black rotate-90 origin-center whitespace-nowrap transition-colors",
                    isDarkMode ? "text-blue-400/80" : "text-blue-500/80"
                  )}>GLASS</span>
                </motion.div>

                {/* Low-E Coating 1 */}
                {glassType !== "single" && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ 
                      opacity: 1,
                      x: isHovered ? -23 : -6,
                      z: isHovered ? 25 : 8,
                    }}
                    className="absolute w-0.5 h-22 bg-gradient-to-b from-teal-400/80 to-emerald-400/80 rounded blur-[0.5px]"
                  />
                )}

                {/* Gas Layer 1 (Double = AIR, Triple = ARGON) */}
                {glassType !== "single" && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ 
                      opacity: 0.25,
                      x: isHovered ? -10 : -2,
                      z: isHovered ? 10 : 2,
                    }}
                    className={cn(
                      "absolute w-7 h-22 border border-dashed rounded flex items-center justify-center transition-all duration-300",
                      glassType === "double" 
                        ? (isDarkMode ? "bg-slate-500/5 border-slate-700/60" : "bg-slate-100/50 border-slate-300/60")
                        : (isDarkMode ? "bg-emerald-500/10 border-emerald-400/20" : "bg-emerald-500/5 border-emerald-400/20")
                    )}
                  >
                    <span className={cn(
                      "text-[5px] font-bold tracking-tighter transition-colors",
                      glassType === "double" 
                        ? (isDarkMode ? "text-slate-400" : "text-slate-500") 
                        : (isDarkMode ? "text-emerald-400" : "text-emerald-600")
                    )}>
                      {glassType === "double" ? "AIR" : "ARGON"}
                    </span>
                  </motion.div>
                )}

                {/* 2nd Glass */}
                {glassType !== "single" && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ 
                      opacity: 0.8,
                      x: isHovered ? 15 : 8,
                      z: isHovered ? -15 : -6,
                    }}
                    className={cn(
                      "absolute w-5 h-24 border-2 rounded backdrop-blur-[1px] flex flex-col justify-between items-center py-2 transition-all duration-300",
                      isDarkMode 
                        ? "bg-blue-300/10 border-blue-400/35" 
                        : "bg-blue-500/5 border-blue-400/30"
                    )}
                  >
                    <div className={cn("w-0.5 h-1/3 rounded-full transition-colors", isDarkMode ? "bg-white/20" : "bg-blue-500/20")} />
                    <span className={cn(
                      "text-[6px] font-black rotate-90 origin-center whitespace-nowrap transition-colors",
                      isDarkMode ? "text-blue-400/80" : "text-blue-500/80"
                    )}>GLASS</span>
                  </motion.div>
                )}

                {/* Triple Only */}
                {glassType === "triple" && (
                  <>
                    {/* Low-E Coating 2 */}
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ 
                        opacity: 1,
                        x: isHovered ? 20 : 10,
                        z: isHovered ? -23 : -9,
                      }}
                      className="absolute w-0.5 h-22 bg-gradient-to-b from-teal-400/80 to-cyan-400/80 rounded blur-[0.5px]"
                    />

                    {/* Argon Gas Layer 2 */}
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ 
                        opacity: 0.25,
                        x: isHovered ? 28 : 14,
                        z: isHovered ? -30 : -12,
                      }}
                      className={cn(
                        "absolute w-7 h-22 border border-dashed rounded flex items-center justify-center transition-all duration-300",
                        isDarkMode ? "bg-cyan-500/10 border-cyan-400/20" : "bg-cyan-500/5 border-cyan-400/20"
                      )}
                    >
                      <span className={cn(
                        "text-[5px] font-bold tracking-tighter transition-colors",
                        isDarkMode ? "text-cyan-400" : "text-cyan-600"
                      )}>ARGON</span>
                    </motion.div>

                    {/* 3rd Glass */}
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ 
                        opacity: 0.8,
                        x: isHovered ? 45 : 22,
                        z: isHovered ? -50 : -20,
                      }}
                      className={cn(
                        "absolute w-5 h-24 border-2 rounded backdrop-blur-[1px] flex flex-col justify-between items-center py-2 transition-all duration-300",
                        isDarkMode 
                          ? "bg-blue-300/10 border-blue-400/30" 
                          : "bg-blue-500/5 border-blue-400/30"
                      )}
                    >
                      <div className={cn("w-0.5 h-1/3 rounded-full transition-colors", isDarkMode ? "bg-white/20" : "bg-blue-500/20")} />
                      <span className={cn(
                        "text-[6px] font-black rotate-90 origin-center whitespace-nowrap transition-colors",
                        isDarkMode ? "text-blue-400/80" : "text-blue-500/80"
                      )}>GLASS</span>
                    </motion.div>
                  </>
                )}
              </motion.div>

              {/* Particle Overlay */}
              <div className="absolute inset-0 z-20 pointer-events-none">
                {/* Heat Streams */}
                <div className="absolute top-[25%] h-1 w-full bg-transparent overflow-hidden">
                  <div className="w-6 h-full bg-gradient-to-r from-red-500 to-amber-400 rounded-full absolute left-0 animate-heat-stream" />
                </div>
                <div className="absolute top-[50%] h-1.5 w-full bg-transparent overflow-hidden">
                  <div className="w-8 h-full bg-gradient-to-r from-red-500 to-orange-500 rounded-full absolute left-0 animate-heat-stream" style={{ animationDelay: '0.8s' }} />
                </div>
                <div className="absolute top-[75%] h-1 w-full bg-transparent overflow-hidden">
                  <div className="w-6 h-full bg-gradient-to-r from-orange-500 to-yellow-400 rounded-full absolute left-0 animate-heat-stream" style={{ animationDelay: '1.6s' }} />
                </div>

                {/* Reflections */}
                {glassType !== "single" && (
                  <>
                    <div className="absolute top-[25%] w-1.5 h-1.5 rounded-full bg-yellow-400 blur-[1px] animate-heat-reflect" style={{ animationDelay: '1.2s' }} />
                    <div className="absolute top-[50%] w-2 h-2 rounded-full bg-orange-400 blur-[1px] animate-heat-reflect" style={{ animationDelay: '0.5s' }} />
                    <div className="absolute top-[75%] w-1.5 h-1.5 rounded-full bg-yellow-300 blur-[1px] animate-heat-reflect" style={{ animationDelay: '2.1s' }} />
                  </>
                )}

                {/* Cool circulation */}
                {glassType === "triple" && (
                  <>
                    <div className="absolute right-[10%] top-[30%] w-1.5 h-1.5 rounded-full bg-cyan-400/60 blur-[1px] animate-cool-circulation" />
                    <div className="absolute right-[20%] top-[60%] w-2 h-2 rounded-full bg-blue-400/60 blur-[1px] animate-cool-circulation" style={{ animationDelay: '1.5s' }} />
                  </>
                )}

                {/* Escape cool air */}
                {glassType === "single" && (
                  <>
                    <div className="absolute top-[35%] h-1 w-full bg-transparent overflow-hidden">
                      <div className="w-6 h-full bg-gradient-to-l from-blue-400 to-cyan-200 rounded-full absolute right-0 animate-cool-escape" />
                    </div>
                    <div className="absolute top-[65%] h-1 w-full bg-transparent overflow-hidden">
                      <div className="w-6 h-full bg-gradient-to-l from-blue-400 to-teal-200 rounded-full absolute right-0 animate-cool-escape" style={{ animationDelay: '1.8s' }} />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Room Comfort */}
            <div className="flex flex-col items-center gap-1 z-10">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border transition-colors duration-500 ${simulatorSpecs.comfortClass}`}>
                {glassType === "single" ? (
                  <Wind className="w-4 h-4 text-rose-400 animate-bounce" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
              </div>
              <span className={cn(
                "text-[7px] font-bold uppercase tracking-wider transition-colors",
                glassType === "single" 
                  ? (isDarkMode ? "text-rose-400" : "text-rose-600") 
                  : (isDarkMode ? "text-emerald-400" : "text-emerald-600")
              )}>실내 환경</span>
            </div>
          </div>
          
          <p className={cn(
            "text-center text-[8px] mt-2 transition-colors",
            isDarkMode ? "text-slate-500" : "text-slate-400"
          )}>
            💡 마우스를 유리에 올리면 3D 레이어가 입체적으로 분해됩니다.
          </p>
        </div>

        {/* Right pane: Specs & Threshold comparison */}
        <div className={cn(
          "w-full md:w-[260px] flex flex-col justify-between border-t md:border-t-0 md:border-l pt-6 md:pt-0 md:pl-6 transition-all duration-300",
          isDarkMode ? "border-slate-800/80 text-slate-200" : "border-slate-200 text-slate-800"
        )}>
          <div className="space-y-5">
            <div>
              <h5 className={cn(
                "text-[10px] uppercase tracking-widest font-bold transition-colors",
                isDarkMode ? "text-slate-500" : "text-slate-400"
              )}>열관류율 (U-value)</h5>
              <div className="flex items-baseline gap-1 mt-1">
                <span className={cn(
                  "text-3xl font-black tracking-tight transition-colors duration-300",
                  glassType === "single" 
                    ? "text-rose-500" 
                    : glassType === "double" 
                      ? (isDarkMode ? "text-slate-200" : "text-slate-800") 
                      : (isDarkMode ? "text-emerald-400" : "text-emerald-600")
                )}>
                  {simulatorSpecs.uValue}
                </span>
                <span className={cn(
                  "text-[10px] font-bold transition-colors",
                  isDarkMode ? "text-slate-500" : "text-slate-400"
                )}>W/m²K</span>
              </div>
              <p className={cn(
                "text-[10px] mt-1 leading-relaxed transition-colors",
                isDarkMode ? "text-slate-400" : "text-slate-500"
              )}>
                {glassType === "single" && "단층 유리는 공기 기밀층이 없어 단열이 불가능하며 심각한 열 전도가 일어납니다."}
                {glassType === "double" && "기본 복층 이중 유리 사양으로 가장 널리 사용되지만 기준에 비해서는 약간 부족할 수 있습니다."}
                {glassType === "triple" && "2중 아르곤 가스와 다중 로이 코팅이 적용되어 열손실을 원천 수준으로 차단합니다."}
              </p>
            </div>

            <div className={cn(
              "border-t pt-4 transition-colors",
              isDarkMode ? "border-slate-800/85" : "border-slate-200"
            )}>
              <h5 className={cn(
                "text-[10px] uppercase tracking-widest font-bold mb-2 transition-colors",
                isDarkMode ? "text-slate-500" : "text-slate-400"
              )}>에절기 중부2 기준 (1.0) 대비</h5>
              <div className="flex items-center gap-2">
                <div className={cn(
                  "px-2 py-1 rounded text-xs font-black tracking-wide flex items-center gap-1 border transition-colors duration-300",
                  glassType === "triple" 
                    ? (isDarkMode ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-emerald-500/5 text-emerald-600 border-emerald-500/20") 
                    : (isDarkMode ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : "bg-rose-500/5 text-rose-600 border-rose-500/20")
                )}>
                  {glassType === "triple" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                  {glassType === "triple" ? "만족" : "미달"}
                </div>
                <span className={`text-xs font-black ${simulatorSpecs.achieveClass}`}>
                  {simulatorSpecs.achieveText}
                </span>
              </div>
              <p className={cn(
                "text-[9px] mt-2 leading-relaxed transition-colors",
                isDarkMode ? "text-slate-500" : "text-slate-400"
              )}>
                * 에너지절약설계기준 중부2 공동주택 외기직접 창호 기준(U-value ≤ 1.0)과 비교한 가상 데이터입니다.
              </p>
            </div>
          </div>

          <div className={cn(
            "border rounded-xl p-3.5 mt-4 transition-all duration-300",
            isDarkMode ? "bg-slate-950/40 border-slate-800/80" : "bg-slate-50 border-slate-200"
          )}>
            <h6 className={cn(
              "text-[9px] font-black uppercase tracking-wider mb-1 flex items-center gap-1 transition-colors",
              isDarkMode ? "text-slate-400" : "text-slate-600"
            )}>
              <Sparkles className="w-3 h-3 text-amber-500" />
              창호 단열 가이드
            </h6>
            <p className={cn(
              "text-[10px] leading-normal break-keep transition-colors",
              isDarkMode ? "text-slate-400" : "text-slate-500"
            )}>
              U-value가 낮을수록 냉난방비 절감률이 비약적으로 증가합니다. 2026년 기준 건축 허가 통과를 위해서는 중부권 기준 최소 1.0 이하 규격 제품 선택을 권장합니다.
            </p>
          </div>
        </div>
      </div>

      {/* 차트 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* 1. 효율등급별 열관류율 분포 박스플롯 */}
        <Card title="효율등급별 열관류율 분포 (Box Plot)" icon={BarChart3}>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={boxPlotData} margin={{ top: 15, right: 15, bottom: 10, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis 
                  dataKey="name" 
                  tick={{ fill: tickColor, fontSize: 11, fontWeight: 'bold' }} 
                  axisLine={false} 
                  tickLine={false} 
                />
                <YAxis 
                  domain={[0.4, 2.4]} 
                  tick={{ fill: tickColor, fontSize: 11 }} 
                  axisLine={false} 
                  tickLine={false} 
                  unit=" W/m²K"
                />
                <RechartsTooltip content={<BoxPlotTooltip />} />
                <Bar 
                  dataKey="boxRange" 
                  shape={<BoxPlotBar fill={isDarkMode ? "#00FF88" : "#2563EB"} stroke={isDarkMode ? "#F1F5F9" : "#CBD5E1"} />} 
                  barSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 2. 프레임재질별 효율등급 분포 */}
        <Card title="프레임재질별 효율등급 분포" icon={Database}>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={frameGradeDistribution} margin={{ top: 15, right: 15, bottom: 10, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis 
                  dataKey="name" 
                  tick={{ fill: tickColor, fontSize: 11, fontWeight: 'bold' }} 
                  axisLine={false} 
                  tickLine={false} 
                />
                <YAxis 
                  tick={{ fill: tickColor, fontSize: 11 }} 
                  axisLine={false} 
                  tickLine={false} 
                  allowDecimals={false}
                />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: '8px' }} 
                  itemStyle={{ color: tooltipColor, fontSize: '11px' }} 
                />
                <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                <Bar dataKey="1등급" stackId="a" fill={chartColors[0]} />
                <Bar dataKey="2등급" stackId="a" fill={chartColors[1]} />
                <Bar dataKey="3등급" stackId="a" fill={chartColors[2]} />
                <Bar dataKey="4등급" stackId="a" fill={chartColors[3]} />
                <Bar dataKey="5등급" stackId="a" fill={chartColors[4]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 3. 유리구성 × 로이여부 조합별 평균 열관류율 */}
        <Card title="유리구성 × 로이여부별 평균 열관류율" icon={Thermometer}>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comboUValueData} layout="vertical" margin={{ top: 15, right: 30, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                <XAxis 
                  type="number" 
                  tick={{ fill: tickColor, fontSize: 11 }} 
                  axisLine={false} 
                  tickLine={false} 
                  unit=" W/m²K"
                />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  width={110} 
                  tick={{ fill: tickColor, fontSize: 10, fontWeight: 'bold' }} 
                  axisLine={false} 
                  tickLine={false} 
                />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: '8px' }} 
                  itemStyle={{ color: tooltipColor, fontSize: '11px' }} 
                  formatter={(value: number) => [`${value} W/m²K`, '평균 열관류율']}
                />
                <Bar dataKey="avgUValue" radius={[0, 6, 6, 0]} barSize={18}>
                  {comboUValueData.map((_, i) => (
                    <Cell key={`combo-${i}`} fill={chartColors[(i + 2) % chartColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 4. 상위 업체 TOP 10 */}
        <Card title="상위 인증 업체 TOP 10" icon={Sparkles}>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCompaniesData} layout="vertical" margin={{ top: 15, right: 30, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                <XAxis 
                  type="number" 
                  tick={{ fill: tickColor, fontSize: 11 }} 
                  axisLine={false} 
                  tickLine={false} 
                  allowDecimals={false}
                  unit="개"
                />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  width={110} 
                  tick={{ fill: tickColor, fontSize: 10, fontWeight: 'bold' }} 
                  axisLine={false} 
                  tickLine={false} 
                />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: '8px' }} 
                  itemStyle={{ color: tooltipColor, fontSize: '11px' }} 
                  formatter={(value: number) => [`${value}개`, '인증 제품 수']}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={14} fill="#8b5cf6">
                  {topCompaniesData.map((_, i) => (
                    <Cell key={`company-${i}`} fill={chartColors[(i + 4) % chartColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </motion.div>
  );
}

// --- Window AI Assistant Chatbot ---

function WindowChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [inputVal, setInputVal] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isClosedManually, setIsClosedManually] = useState(false);
  const messageEndRef = useRef<HTMLDivElement>(null);

  const showPreview = !isOpen && !isClosedManually;

  // Auto-scroll to bottom of chat
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    }
  }, [messages, isLoading, isOpen]);

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    
    // Add user message to state
    const newMessages = [...messages, { role: 'user' as const, content: text }];
    setMessages(newMessages);
    setInputVal("");
    setIsLoading(true);

    try {
      // API payload: keep only the last 20 messages (10 turns) to avoid context overhead
      const apiPayload = newMessages.slice(-20);
      const response = await getClaudeChatbotResponse(apiPayload);
      
      setMessages(prev => [...prev, { role: 'assistant' as const, content: response }]);
    } catch (error) {
      console.error("Chatbot error:", error);
      setMessages(prev => [...prev, { 
        role: 'assistant' as const, 
        content: "죄송합니다. 답변을 생성하는 도중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSendMessage(inputVal);
    }
  };

  const quickQuestions = [
    "U-value가 뭔가요?",
    "효율등급 기준 알려줘",
    "우리 지역 기준은?"
  ];

  return (
    <div className="fixed bottom-6 right-6 z-50 font-sans select-none">
      {/* 말풍선 프리뷰 */}
      <AnimatePresence>
        {showPreview && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, x: 20 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.9, x: 20 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            onClick={() => setIsOpen(true)}
            className="absolute right-16 bottom-2 w-64 p-4 bg-white dark:bg-slate-900 border border-blue-500 dark:border-blue-600 rounded-2xl shadow-xl z-50 text-slate-800 dark:text-slate-200 text-[11px] leading-relaxed flex flex-col gap-1 cursor-pointer select-text"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsClosedManually(true);
              }}
              className="absolute top-2.5 right-2.5 text-slate-400 dark:text-slate-500 hover:text-slate-650 dark:hover:text-slate-350 cursor-pointer p-0.5 rounded-full z-10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <div className="pr-4 font-medium text-slate-600 dark:text-slate-300 pointer-events-none">
              안녕하세요! 저는 WINI예요 👋<br />
              창호 성능이 궁금하시면 물어보세요!
            </div>
            {/* 꼬리표 */}
            <div className="absolute right-[-6px] bottom-5 w-3 h-3 bg-white dark:bg-slate-900 border-r border-t border-blue-500 dark:border-blue-600 rotate-45" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Chat Button */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        animate={isOpen ? { y: 0 } : {
          y: [0, -8, 0]
        }}
        transition={isOpen ? { duration: 0.2 } : {
          y: {
            duration: 0.6,
            repeat: Infinity,
            repeatDelay: 2.4,
            ease: "easeInOut"
          }
        }}
        className="w-14 h-14 bg-blue-600 hover:bg-blue-500 text-white rounded-full flex items-center justify-center shadow-xl cursor-pointer relative group border border-white/10"
      >
        {/* Pulse expanding glow effect */}
        {!isOpen && (
          <span className="absolute inset-0 rounded-full bg-blue-500/50 animate-ping pointer-events-none" />
        )}

        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div
              key="close"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <X className="w-6 h-6" />
            </motion.div>
          ) : (
            <motion.div
              key="chat"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="relative"
            >
              {/* 귀여운 창문 캐릭터 SVG */}
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-white">
                <rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" strokeWidth="2.5" fill="none" />
                <line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" strokeWidth="2.5" />
                <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2.5" />
                <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
                <circle cx="16.5" cy="7.5" r="1.5" fill="currentColor" />
              </svg>
              {/* unread indicator dot */}
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 border-2 border-white dark:border-slate-900 rounded-full animate-pulse" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Chat popup window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-20 right-0 w-[360px] h-[500px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden select-text"
          >
            {/* Header */}
            <div className="px-5 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex justify-between items-center shrink-0 shadow-md">
              <div className="flex items-center gap-2.5">
                {/* WINI 캐릭터 헤더 아이콘 */}
                <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center shrink-0 shadow-sm">
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-4.5 h-4.5 text-blue-600">
                    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2.2" fill="none" />
                    <line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" strokeWidth="2.2" />
                    <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2.2" />
                    <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
                    <circle cx="16.5" cy="7.5" r="1.5" fill="currentColor" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-black tracking-wide">
                    WINI · 창호 AI 어시스턴트
                  </h3>
                  <p className="text-[10px] text-blue-100 font-medium">19,485개 에너지공단 창세트 DB 연동</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {messages.length > 0 && (
                  <button 
                    onClick={() => setMessages([])}
                    title="대화 초기화"
                    className="p-1.5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                  >
                    <RefreshCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button 
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Message Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 dark:bg-slate-950/35">
              {/* Static Welcome Message */}
              <div className="flex gap-2.5 items-start">
                <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 shadow-sm border border-blue-200/20">
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5.5 h-5.5 text-blue-600 dark:text-blue-400">
                    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
                    <line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" strokeWidth="2" />
                    <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" />
                    <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
                    <circle cx="16.5" cy="7.5" r="1.5" fill="currentColor" />
                  </svg>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800/80 text-slate-800 dark:text-slate-200 rounded-2xl rounded-tl-none p-3.5 max-w-[82%] text-[11px] leading-relaxed shadow-sm break-all whitespace-pre-wrap">
                  안녕하세요! 저는 WINI, 창호 AI 어시스턴트예요 👋{"\n"}
                  U-value, SHGC 등 입력값이 궁금하시거나{"\n"}
                  창호 성능에 대해 무엇이든 물어보세요!
                </div>
              </div>

              {/* Message Dialog History */}
              {messages.map((msg, idx) => (
                <div 
                  key={idx} 
                  className={cn(
                    "flex gap-2.5 items-start",
                    msg.role === 'user' ? "justify-end" : "justify-start"
                  )}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 shadow-sm border border-blue-200/20">
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5.5 h-5.5 text-blue-600 dark:text-blue-400">
                        <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
                        <line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" strokeWidth="2" />
                        <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" />
                        <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
                        <circle cx="16.5" cy="7.5" r="1.5" fill="currentColor" />
                      </svg>
                    </div>
                  )}
                  <div 
                    className={cn(
                      "p-3.5 text-[11px] leading-relaxed shadow-sm break-all whitespace-pre-wrap",
                      msg.role === 'user' 
                        ? "bg-blue-600 text-white rounded-2xl rounded-tr-none max-w-[80%]" 
                        : "bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800/80 text-slate-800 dark:text-slate-200 rounded-2xl rounded-tl-none max-w-[82%]"
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Loading Dots */}
              {isLoading && (
                <div className="flex gap-2.5 items-start">
                  <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-200/20">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5.5 h-5.5 text-blue-600 dark:text-blue-400">
                      <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
                      <line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" strokeWidth="2" />
                      <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" />
                      <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
                      <circle cx="16.5" cy="7.5" r="1.5" fill="currentColor" />
                    </svg>
                  </div>
                  <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800/80 rounded-2xl rounded-tl-none p-4 max-w-[82%] shadow-sm flex items-center gap-1.5 h-10 shrink-0">
                    <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}

              {/* Suggestion Chips - show when history is empty (only the greeting is shown) */}
              {messages.length === 0 && !isLoading && (
                <div className="pt-2 pl-9 space-y-2 max-w-[90%]">
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">추천 질문</p>
                  <div className="flex flex-col gap-1.5">
                    {quickQuestions.map((q) => (
                      <button
                        key={q}
                        onClick={() => handleSendMessage(q)}
                        className="w-full text-left px-3.5 py-2.5 bg-white dark:bg-slate-800 hover:bg-blue-500/10 dark:hover:bg-blue-900/20 border border-slate-200 dark:border-slate-800 hover:border-blue-200 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl text-[11px] font-bold transition-all shadow-sm cursor-pointer"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div ref={messageEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800/80 flex gap-2 items-center shrink-0">
              <input
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={handleKeyPress}
                disabled={isLoading}
                placeholder="질문을 입력하세요..."
                className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-[11px] focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-200 placeholder-slate-400 disabled:opacity-60"
              />
              <button
                onClick={() => handleSendMessage(inputVal)}
                disabled={!inputVal.trim() || isLoading}
                className="p-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-all disabled:opacity-40 disabled:hover:bg-blue-600 flex items-center justify-center shrink-0 cursor-pointer shadow-md shadow-blue-500/10"
              >
                {isLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Main App ---

function App() {
  const [input, setInput] = useState({
    region: "central2",
    buildingType: "residential_apartment",
    contactType: "direct",
    uValue: 1.5,
    shgc: 0.4,
    airtight: 3,
    tdr: 0.3,
    frame: "AL",
    area: 15,
    glassConfig: "triple",
    loweCoating: "yes"
  });
  const [result, setResult] = useState<any>(null);
  const [tab, setTab] = useState("stats");
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem("theme");
    return savedTheme !== "light";
  });
  const [activeTooltipTab, setActiveTooltipTab] = useState<string | null>(null);
  const [tooltipX, setTooltipX] = useState<number>(0);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isStarted, setIsStarted] = useState(false);
  const [glassType, setGlassType] = useState<"single" | "double" | "triple">("triple");
  const [isHovered, setIsHovered] = useState(false);
  const [isPdfGenerating, setIsPdfGenerating] = useState(false);

  const handleStart = () => {
    setIsStarted(true);
  };

  useEffect(() => {
    if (!isStarted) {
      document.documentElement.classList.add("dark");
    } else {
      if (isDarkMode) {
        document.documentElement.classList.add("dark");
        localStorage.setItem("theme", "dark");
      } else {
        document.documentElement.classList.remove("dark");
        localStorage.setItem("theme", "light");
      }
    }
  }, [isDarkMode, isStarted]);

  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    };
  }, []);

  const [aiAnalysis, setAiAnalysis] = useState<ClaudeAnalysisResult | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2000);
  };
  const [supabaseProducts, setSupabaseProducts] = useState<any[]>([]);
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);

  const [thresholds, setThresholds] = useState({
    uValue: 1.0,
    airtight: 2,
    tdr: 0.25
  });

  // Update thresholds based on region, building type, and contact type changes
  useEffect(() => {
    const computedU = U_VALUE_THRESHOLDS[input.buildingType]?.[input.contactType]?.[input.region] ?? 1.0;
    const computedTdr = TDR_THRESHOLDS[input.region] ?? 0.25;
    const computedAirtight = input.buildingType === "residential_apartment" ? 1 : 2;

    setThresholds(prev => ({
      ...prev,
      uValue: computedU,
      tdr: computedTdr,
      airtight: computedAirtight
    }));
  }, [input.region, input.buildingType, input.contactType]);

  const hc = (k: string, v: any) => setInput(p => ({ ...p, [k]: v }));
  const ht = (k: string, v: any) => setThresholds(p => ({ ...p, [k]: v }));

  const analyze = (inputData: typeof input, th: typeof thresholds) => {
    const results = [];
    let score = 0;
    const improvements = [];

    // 수치 안전 형변환 (NaN 방지)
    const uVal = typeof inputData.uValue === "string" ? parseFloat(inputData.uValue) : (inputData.uValue || 0);
    const shgcVal = typeof inputData.shgc === "string" ? parseFloat(inputData.shgc) : (inputData.shgc || 0);
    const airtightVal = typeof inputData.airtight === "string" ? parseInt(inputData.airtight) : (inputData.airtight || 1);
    const tdrVal = typeof inputData.tdr === "string" ? parseFloat(inputData.tdr) : (inputData.tdr || 0);
    const areaVal = typeof inputData.area === "string" ? parseFloat(inputData.area) : (inputData.area || 15);

    const thUValue = typeof th.uValue === "string" ? parseFloat(th.uValue) : (th.uValue || 1.0);
    const thAirtight = typeof th.airtight === "string" ? parseInt(th.airtight) : (th.airtight || 2);
    const thTdr = typeof th.tdr === "string" ? parseFloat(th.tdr) : (th.tdr || 0.25);

    // 1. 열관류율 (U-value) - 3점 (에절기 핵심 항목)
    const uPass = uVal <= thUValue;
    if (uPass) score += 3;
    const excessPercent = thUValue > 0 ? ((uVal - thUValue) / thUValue * 100) : 0;
    const excessText = isNaN(excessPercent) ? "0.0" : excessPercent.toFixed(1);
    results.push({
      label: "열관류율 (U-value)",
      value: `${uVal.toFixed(2)} W/m²·K`,
      standard: `≤ ${thUValue.toFixed(1)}`,
      pass: uPass,
      detail: uPass ? "설정 기준 충족 (+3점)" : `기준 대비 ${excessText}% 초과 (+0점)`
    });
    if (!uPass) improvements.push({ priority: "높음", title: "열관류율 개선", actions: ["로이(Low-E) 코팅 유리 적용", "삼중유리 또는 진공유리 교체", "아르곤/크립톤 가스 충전", `목표: U ≤ ${thUValue} W/m²·K`] });

    // 2. 기밀성 등급 - 2점
    const airPass = airtightVal <= thAirtight;
    if (airPass) score += 2;
    results.push({
      label: "기밀성 등급",
      value: `${airtightVal}등급`,
      standard: `≤ ${thAirtight}등급`,
      pass: airPass,
      detail: airPass ? "침기 열손실 양호 (+2점)" : "침기량 과다 (기밀성 부족) (+0점)"
    });
    if (!airPass) improvements.push({ priority: "높음", title: "기밀성 개선", actions: ["기밀 가스켓 교체/추가", "하드웨어 조정", `최소 ${thAirtight}등급 이하 제품 교체`] });

    // 3. 결로방지 (TDR) - 2점
    const tdrPass = tdrVal <= thTdr;
    if (tdrPass) score += 2;
    results.push({
      label: "결로방지 (TDR)",
      value: `${tdrVal.toFixed(2)}`,
      standard: `≤ ${thTdr.toFixed(2)}`,
      pass: tdrPass,
      detail: tdrPass ? "결로 위험 낮음 (+2점)" : "결로 위험 높음 (표면 온도 저하) (+0점)"
    });
    if (!tdrPass) improvements.push({ priority: "높음", title: "결로방지 개선", actions: ["단열 스페이서(Warm Edge) 적용", "프레임 단열 보강", "설치 디테일 개선"] });

    // 4. 일사열취득률 (SHGC) - 1점 (참고값)
    score += 1;
    results.push({
      label: "일사열취득률 (SHGC)",
      value: `${shgcVal.toFixed(2)}`,
      standard: "-",
      pass: true,
      isReference: true,
      detail: "참고용 지표 (진단 점수 1점 반영)"
    });

    // 5. 유리 구성 (복층 이상) - 1점
    const glassPass = inputData.glassConfig === "double" || inputData.glassConfig === "triple";
    if (glassPass) score += 1;
    const glassLabel = inputData.glassConfig === "triple" ? "삼중" : inputData.glassConfig === "double" ? "복층" : "단층";
    results.push({
      label: "유리 구성",
      value: glassLabel,
      standard: "복층 이상",
      pass: glassPass,
      detail: glassPass ? `${glassLabel}유리 적용 완료 (+1점)` : "단층 유리 사용 (교체 권장) (+0점)"
    });

    // 6. 로이 코팅 (적용) - 1점
    const lowePass = inputData.loweCoating === "yes";
    if (lowePass) score += 1;
    results.push({
      label: "로이 코팅",
      value: lowePass ? "적용" : "미적용",
      standard: "적용",
      pass: lowePass,
      detail: lowePass ? "로이 코팅 적용 완료 (+1점)" : "로이 코팅 미적용 (+0점)"
    });

    // 에너지 계산
    const dT = 25;
    const hLW = uVal * areaVal * dT;
    const hLI = airtightVal * 0.5 * areaVal * dT * 0.33;
    const tL = hLW + hLI;

    const grade = score >= 8 ? "Excellent" : score >= 5 ? "Average" : "Critical";

    return { 
      results, 
      score, 
      maxScore: 10, 
      grade,
      improvements, 
      energy: { 
        heatLossWindow: hLW, 
        infiltrationLoss: hLI, 
        totalLoss: tL, 
        area: areaVal
      } 
    };
  };

  const handleRunAnalysis = async (customInput?: typeof input) => {
    const isSpecApply = customInput && typeof (customInput as any).uValue !== "undefined";
    const activeInput = isSpecApply ? (customInput as typeof input) : input;
    const res = analyze(activeInput, thresholds);
    setResult(res);
    setTab("result");
    if (!isSpecApply) {
      setAiAnalysis(null);
    }

    // Supabase에서 제품 데이터 가져오기
    setIsProductsLoading(true);
    setProductsError(null);
    setSupabaseProducts([]);
    setSelectedProducts([]);
    try {
      const frameMap: Record<string, string> = { 
        all: "전체",
        AL: "알루미늄", 
        PVC: "PVC", 
        AL_PVC: "복합(AL+PVC)", 
        WOOD: "목재", 
        WOOD_AL: "복합(목재+AL)" 
      };

      const regionLimit = REGION_U_LIMITS[activeInput.region] || 1.0;

      // U-value 필터 기준 결정
      let queryUValue = regionLimit;
      let isStrictlyLower = false;

      if (activeInput.uValue <= regionLimit) {
        // 이미 지역 기준 이하인 경우, 현재 입력값보다 작아야 교체 의미가 있으므로 미만(<) 조건 사용
        queryUValue = activeInput.uValue;
        isStrictlyLower = true;
      }

      const selectedFrame = frameMap[activeInput.frame];
      const queryFrame = (selectedFrame === "전체") ? undefined : selectedFrame;

      // 1단계 조회: 에절기 지역 기준값 이하이면서 현재 U-value보다 낮은 제품 우선 조회
      let products = await getProductsByUValue(
        queryUValue,
        queryFrame,
        undefined, // 유리구성 필터 해제 (클라이언트단에서 복합 스코어링 반영)
        undefined, // 로이코팅 필터 해제 (클라이언트단에서 복합 스코어링 반영)
        isStrictlyLower,
        100
      );

      // 2단계 조회: 만약 결과가 없고, 사용자 U-value가 지역 기준치보다 높다면 (regionLimit < activeInput.uValue),
      // 단순히 U-value가 기존보다 낮은(< activeInput.uValue) 제품을 조회 (조건 완화)
      if ((!products || products.length === 0) && activeInput.uValue > regionLimit) {
        products = await getProductsByUValue(
          activeInput.uValue,
          queryFrame,
          undefined,
          undefined,
          true, // 미만 조건
          100
        );
      }

      const rawProducts = products || [];

      // 복합 점수 산출
      const scoredProducts = rawProducts.map((p: any) => {
        // 효율 등급 점수: 1등급 = 5점, 2등급 = 4점, 3등급 = 3점, 4등급 = 2점, 5등급 = 1점, 기타 = 0점
        let gradeScore = 0;
        const grade = p.효율등급;
        if (grade >= 1 && grade <= 5) {
          gradeScore = 6 - grade;
        }

        // 프레임 재질 일치 여부: 사용자 선택 재질과 일치 시 +2점 (사용자가 전체 'all'을 선택한 경우 제외)
        const frameMatch = (activeInput.frame !== "all" && p.프레임재질 === frameMap[activeInput.frame]) ? 2 : 0;

        // 유리 구성 일치 여부: 사용자 선택 유리구성과 일치 시 +1점
        const glassMap: Record<string, string> = {
          single: "단층",
          double: "복층",
          triple: "삼중"
        };
        const glassMatch = p.유리구성 === glassMap[activeInput.glassConfig] ? 1 : 0;

        // 로이 코팅 일치 여부: 사용자 선택 적용 여부와 일치 시 +1점
        const loweMatch = p.로이여부 === (activeInput.loweCoating === "yes") ? 1 : 0;

        const compositeScore = gradeScore + frameMatch + glassMatch + loweMatch;

        return {
          ...p,
          compositeScore
        };
      });

      // 복합 점수 기준 내림차순 정렬, 동점일 경우 열관류율 오름차순 서브 정렬
      scoredProducts.sort((a, b) => {
        if (b.compositeScore !== a.compositeScore) {
          return b.compositeScore - a.compositeScore;
        }
        return (a.열관류율 || 0) - (b.열관류율 || 0);
      });

      const finalProducts = scoredProducts.slice(0, 10);
      setSupabaseProducts(finalProducts);

      if (finalProducts.length > 0) {
        setSelectedProducts([finalProducts[0].id]);
      } else {
        setSelectedProducts([]);
      }
    } catch (err: any) {
      console.error("제품 조회 실패:", err);
      setProductsError(err.message || "제품 데이터를 불러오는데 실패했습니다.");
    } finally {
      setIsProductsLoading(false);
    }
  };

  const handleAiAnalysis = async () => {
    if (!result) return;
    setIsAiLoading(true);
    try {
      const regionName = (REGIONS as any)[input.region].name;
      const aiRes = await getClaudeWindowAnalysis({
        uValue: input.uValue,
        shgc: input.shgc,
        airtight: input.airtight,
        tdr: input.tdr,
        area: input.area,
        regionName,
        frame: input.frame,
        buildingType: input.buildingType,
        contactType: input.contactType
      });
      setAiAnalysis(aiRes);
    } catch (error) {
      console.error("Claude Analysis failed:", error);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!result || !aiAnalysis) return;
    setIsPdfGenerating(true);
    try {
      // Robust imports handling for different bundler environments (CommonJS/ESM interop)
      const jsPDFConstructor = (jsPDF as any).jsPDF || (jsPDF as any).default || jsPDF;
      const html2canvasLib = (html2canvas as any).default || html2canvas;

      const doc = new jsPDFConstructor({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pageIds = [
        "pdf-page-cover",
        "pdf-page-input",
        "pdf-page-score",
        "pdf-page-ai",
        "pdf-page-products"
      ];

      for (let i = 0; i < pageIds.length; i++) {
        const element = document.getElementById(pageIds[i]);
        if (!element) continue;

        const canvas = await html2canvasLib(element, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: "#ffffff",
          scrollX: 0,
          scrollY: 0
        });

        const imgData = canvas.toDataURL("image/jpeg", 0.95);
        
        if (i > 0) {
          doc.addPage();
        }
        doc.addImage(imgData, "JPEG", 0, 0, 210, 297);
      }

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const filename = `WinEnergy_진단결과_${year}${month}${day}.pdf`;

      doc.save(filename);
    } catch (err: any) {
      console.error("PDF 생성 에러:", err);
      alert("PDF 리포트를 생성하는 과정에서 에러가 발생했습니다:\n" + (err?.message || err || "알 수 없는 오류"));
    } finally {
      setIsPdfGenerating(false);
    }
  };

  const toggleProductSelection = (id: string) => {
    setSelectedProducts((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleResetSelection = () => {
    const bestMatchId = supabaseProducts.length > 0 ? [supabaseProducts[0].id] : [];
    setSelectedProducts(bestMatchId);
    setShowCompareModal(false);
    showToast("선택이 초기화되었습니다");
  };

  const compareList = supabaseProducts.filter((p: any) => selectedProducts.includes(p.id));

  const energyData = result ? [
    { name: '창호 열관류', value: result.energy.heatLossWindow, fill: '#3b82f6' },
    { name: '침기 손실', value: result.energy.infiltrationLoss, fill: '#8b5cf6' },
  ] : [];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0a0f1a] text-slate-800 dark:text-slate-200 font-sans selection:bg-blue-500/30 transition-colors duration-300">
      <AnimatePresence mode="wait">
        {!isStarted ? (
          <motion.div
            key="landing"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
            className="w-full h-screen overflow-hidden"
          >
            {/* Landing Hero Section */}
            <section className="relative h-screen w-full flex flex-col justify-between items-center bg-[#050811] text-white overflow-hidden select-none px-6 py-12">
              
              {/* Canvas: Particles + Grid (interactive, parallax) */}
              <HeroCanvasBackground />

              {/* Dynamic Aurora Fluid Blobs */}
              <div className="absolute inset-0 z-[1] overflow-hidden pointer-events-none opacity-50">
                <div className="absolute top-[-10%] right-[-10%] w-[55%] h-[55%] bg-emerald-500/15 blur-[120px] rounded-full animate-aurora-1" />
                <div className="absolute bottom-[-15%] left-[-15%] w-[65%] h-[65%] bg-purple-600/15 blur-[130px] rounded-full animate-aurora-2" />
                <div className="absolute top-[30%] left-[20%] w-[45%] h-[45%] bg-teal-500/10 blur-[110px] rounded-full animate-aurora-3" />
              </div>

              {/* Glass Shimmer Sweep — diagonal light reflection */}
              <div className="absolute inset-0 z-[2] overflow-hidden pointer-events-none">
                <div
                  className="absolute top-0 h-full animate-hero-shimmer"
                  style={{
                    left: 0,
                    width: '30%',
                    background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.025) 50%, transparent)',
                  }}
                />
              </div>

              {/* Top bar (Brand logo) */}
              <div className="z-10 w-full max-w-5xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">WinEnergy Intelligence</span>
                </div>
              </div>

              {/* Center Content */}
              <div className="z-10 w-full max-w-3xl text-center flex flex-col items-center justify-center flex-1 my-auto space-y-12">
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="space-y-6"
                >
                  {/* Badge — text only, no icon */}
                  <div className="inline-flex items-center px-3.5 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-400 text-[11px] font-bold tracking-wide mx-auto">
                    국토교통부 고시 에너지절약설계기준 최신 요건 진단
                  </div>
                  
                  {/* Main Title — typing animation char by char */}
                  <h2 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white uppercase leading-none">
                    <TypingText
                      text="WINENERGY"
                      delay={200}
                      hideCursor
                      className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-teal-400 to-indigo-400"
                    />
                    {" "}
                    <br className="sm:hidden" />
                    <TypingText
                      text="ANALYSIS TOOL"
                      delay={900}
                      hideCursor
                      className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-300 via-sky-300 to-emerald-400 font-extrabold"
                    />
                  </h2>
                  
                  {/* Slogans */}
                  <div className="space-y-3 pt-4">
                    <p className="text-slate-300 text-sm sm:text-lg font-bold min-h-[28px] leading-relaxed">
                      <TypingText text="한국에너지공단 인증 19,485개 창세트 DB 기반" delay={1800} hideCursor />
                    </p>
                    <p className="text-emerald-400 text-sm sm:text-lg font-black min-h-[28px] leading-relaxed">
                      <TypingText text="AI 심층 분석으로 최적 창호를 찾아드립니다" delay={3200} hideCursor />
                    </p>
                  </div>
                </motion.div>

                {/* Stats Row */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.8, delay: 0.3 }}
                  className="w-full max-w-2xl grid grid-cols-3 gap-2 sm:gap-4 p-6 bg-slate-900/30 backdrop-blur-xl border border-white/5 rounded-2xl shadow-2xl shadow-black/40"
                >
                  <div className="text-center border-r border-white/5 last:border-0 py-2">
                    <div className="text-xl sm:text-3xl font-black text-white">
                      <CountUp end={19485} duration={1500} suffix="개" />
                    </div>
                    <div className="text-[9px] sm:text-xs font-bold text-slate-500 mt-2 uppercase tracking-widest">인증 제품</div>
                  </div>
                  
                  <div className="text-center border-r border-white/5 last:border-0 py-2">
                    <div className="text-xl sm:text-3xl font-black text-emerald-400">
                      <CountUp end={5} duration={800} suffix="등급" />
                    </div>
                    <div className="text-[9px] sm:text-xs font-bold text-slate-500 mt-2 uppercase tracking-widest">효율 등급</div>
                  </div>
                  
                  <div className="text-center last:border-0 py-2">
                    <div className="text-xl sm:text-3xl font-black text-indigo-400">
                      AI
                    </div>
                    <div className="text-[9px] sm:text-xs font-bold text-slate-500 mt-2 uppercase tracking-widest">심층 분석</div>
                  </div>
                </motion.div>

                {/* CTA Button */}
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.5 }}
                  className="pt-4"
                >
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleStart}
                    className="relative overflow-hidden px-10 py-4 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600 text-white font-black text-sm uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-emerald-950/30 group cursor-pointer animate-shine-hover"
                  >
                    <span className="relative z-10 flex items-center gap-2">
                      진단 시작하기
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1.5 transition-transform" />
                    </span>
                  </motion.button>
                </motion.div>
              </div>

              {/* Bottom footer */}
              <div className="z-10 text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em]">
                © 2026 WinEnergy Analysis Tool by Sohee Shim
              </div>
            </section>
          </motion.div>
        ) : (
          <motion.div
            key="app"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="w-full"
          >
            {/* Background Decor */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
              <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] blur-[120px] rounded-full opacity-[0.05]" style={{ backgroundColor: "var(--color-primary)" }} />
              <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] blur-[120px] rounded-full opacity-[0.03]" style={{ backgroundColor: "var(--color-chart-2)" }} />
            </div>

            <div className="relative max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10 border-b pb-6" style={{ borderColor: "var(--color-card-border)" }}>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="bg-blue-500/10 dark:bg-blue-500/20 p-1.5 rounded-lg">
                <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">Building Energy Intelligence</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ color: "var(--color-text)" }}>
              WinEnergy <span style={{ color: "var(--color-primary)" }}>Analysis Tool</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed break-keep" style={{ color: "var(--color-text-sub)" }}>
              창호 성능 진단 및 에너지 효율 최적화를 위한 지능형 분석 시스템입니다. <br className="hidden sm:inline" />
              에너지절약설계기준을 바탕으로 정밀한 진단을 제공합니다.
            </p>
          </div>

          {/* Theme Toggle Button */}
          <div className="flex items-center justify-end">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl shadow-sm font-bold text-xs transition-colors cursor-pointer" style={{ backgroundColor: "var(--color-card)", border: "1px solid var(--color-card-border)", color: "var(--color-text-sub)" }}
            >
              {isDarkMode ? (
                <>
                  <Sun className="w-4 h-4 text-amber-500 animate-pulse" />
                  라이트 모드 보기
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-indigo-500" />
                  다크 모드 보기
                </>
              )}
            </motion.button>
          </div>
        </header>

        {/* Navigation Tabs */}
        <div ref={containerRef} className="relative mb-8">
          <AnimatePresence>
            {activeTooltipTab && (
              <motion.div
                initial={{ opacity: 0, y: 5, scale: 0.95, x: "-50%" }}
                animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
                exit={{ opacity: 0, y: 5, scale: 0.95, x: "-50%" }}
                style={{ left: tooltipX }}
                className="absolute bottom-full mb-2 px-3 py-1.5 bg-slate-900 dark:bg-slate-950 border border-slate-800/80 text-rose-500 dark:text-rose-400 text-xs font-bold rounded-lg shadow-2xl z-50 whitespace-nowrap pointer-events-none"
              >
                이전 단계를 먼저 완료해주세요
                <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-slate-900 dark:border-t-slate-950" />
              </motion.div>
            )}
          </AnimatePresence>

          <nav className="flex items-center gap-1 bg-slate-200/50 dark:bg-slate-900/60 p-1 rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto no-scrollbar transition-colors">
            {[
              { id: "stats", label: "통계", icon: TrendingUp, disabled: false },
              { id: "input", label: "데이터 입력", icon: Settings2, disabled: false },
              { id: "result", label: "진단 결과", icon: LayoutDashboard, disabled: !result },
              { id: "ai", label: "심층 분석", icon: Sparkles, disabled: !result },
              { id: "recommend", label: "제품 추천", icon: Database, disabled: !aiAnalysis },
            ].map((t) => (
              <motion.button
                key={t.id}
                whileTap={{ scale: 0.96 }}
                onClick={(e) => {
                  if (t.disabled) {
                    if (containerRef.current) {
                      const containerRect = containerRef.current.getBoundingClientRect();
                      const buttonRect = e.currentTarget.getBoundingClientRect();
                      const x = buttonRect.left - containerRect.left + buttonRect.width / 2;
                      setTooltipX(x);
                    }
                    setActiveTooltipTab(t.id);
                    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
                    tooltipTimeoutRef.current = setTimeout(() => {
                      setActiveTooltipTab(null);
                    }, 2000);
                  } else {
                    setTab(t.id);
                    setActiveTooltipTab(null);
                  }
                }}
                className={cn(
                  "flex items-center px-5 py-2.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap cursor-pointer",
                  tab === t.id 
                    ? "bg-[var(--color-primary)] text-white shadow-lg shadow-blue-900/20" 
                    : "text-slate-600 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-300 hover:bg-slate-300/40 dark:hover:bg-slate-800/50",
                  t.disabled && "opacity-30 cursor-not-allowed"
                )}
              >
                {t.label}
              </motion.button>
            ))}
          </nav>
        </div>

        <main>
          <AnimatePresence mode="wait">
            {/* --- INPUT TAB --- */}
            {tab === "input" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="grid grid-cols-1 md:grid-cols-3 gap-6"
              >
                <div className="md:col-span-2 space-y-6">
                  <Card title="기본 정보 및 성능 사양" icon={Settings2}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <SelectField 
                        label="분석 지역" 
                        value={input.region} 
                        onChange={(v: string) => hc("region", v)}
                        options={Object.entries(REGIONS).map(([k, v]) => ({ value: k, label: v.name }))}
                      />
                      <SelectField 
                        label="건물 용도" 
                        value={input.buildingType} 
                        onChange={(v: string) => hc("buildingType", v)}
                        options={BUILDING_TYPES}
                      />
                      <SelectField 
                        label="외기 접촉 여부" 
                        value={input.contactType} 
                        onChange={(v: string) => hc("contactType", v)}
                        options={CONTACT_TYPES}
                      />
                      <InputField label="창호 면적 (m²)" value={input.area} onChange={(v: string) => hc("area", parseFloat(v))} />
                      <SelectField 
                        label="프레임 재질" 
                        value={input.frame} 
                        onChange={(v: string) => hc("frame", v)}
                        options={FRAME_TYPES.map(f => ({ value: f, label: FRAME_LABELS[f] }))}
                      />
                    </div>
                  </Card>

                  <Card title="창호 구성 정보" icon={Info}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <SelectField 
                        label="유리구성" 
                        value={input.glassConfig} 
                        onChange={(v: string) => hc("glassConfig", v)}
                        options={[
                          { value: "single", label: "단층" },
                          { value: "double", label: "복층" },
                          { value: "triple", label: "삼중" }
                        ]}
                      />
                      <SelectField 
                        label="로이코팅 여부" 
                        value={input.loweCoating} 
                        onChange={(v: string) => hc("loweCoating", v)}
                        options={[
                          { value: "yes", label: "적용" },
                          { value: "no", label: "미적용" }
                        ]}
                      />
                    </div>
                  </Card>

                  <Card title="창호 성능 입력" icon={Thermometer}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <InputField label="열관류율 (U-value) (W/m²·K)" value={input.uValue} onChange={(v: string) => hc("uValue", parseFloat(v))} step="0.01" />
                      <InputField label="일사열취득률 (SHGC) (참고값)" value={input.shgc} onChange={(v: string) => hc("shgc", parseFloat(v))} step="0.01" />
                      <SelectField 
                        label="기밀성 등급" 
                        value={input.airtight} 
                        onChange={(v: string) => hc("airtight", parseInt(v))}
                        options={AIRTIGHT_GRADES.map(g => ({ value: g, label: `${g}등급` }))}
                      />
                      <InputField label="결로방지성능 (TDR)" value={input.tdr} onChange={(v: string) => hc("tdr", parseFloat(v))} step="0.01" />
                    </div>
                  </Card>

                  <Card title="분석 기준 설정 (Thresholds)" icon={Settings2} className="border-blue-500/20 bg-blue-500/5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                      <InputField label="U-value 기준" value={thresholds.uValue} onChange={(v: string) => ht("uValue", parseFloat(v))} step="0.1" />
                      <SelectField 
                        label="기밀성 기준" 
                        value={thresholds.airtight} 
                        onChange={(v: string) => ht("airtight", parseInt(v))}
                        options={AIRTIGHT_GRADES.map(g => ({ value: g, label: `${g}등급 이하` }))}
                      />
                      <InputField label="TDR 기준" value={thresholds.tdr} onChange={(v: string) => ht("tdr", parseFloat(v))} step="0.01" />
                    </div>
                    <p className="text-[10px] text-blue-400/60 mt-4 italic">
                      * 건물 및 지역 조건을 변경하면 기준이 자동으로 설정되지만, 필요시 임의 조정이 가능합니다.
                    </p>
                  </Card>
                </div>

                <aside className="space-y-6">
                  <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-6 shadow-xl shadow-blue-900/20">
                    <h3 className="text-xl font-black text-white mb-2">진단 시작</h3>
                    <p className="text-blue-100 text-xs leading-relaxed mb-6">
                      입력된 데이터를 바탕으로 에너지 효율 등급을 계산하고 개선 방안을 도출합니다.
                    </p>
                    <motion.button 
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleRunAnalysis}
                      className="w-full bg-white text-blue-700 font-black py-3 rounded-xl hover:bg-slate-100 transition-colors flex items-center justify-center gap-2 group cursor-pointer shadow-md"
                    >
                      분석 실행
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </motion.button>
                  </div>

                  <Card title="도움말" icon={Info}>
                    <ul className="space-y-3 text-xs text-slate-400">
                      <li className="flex gap-2">
                        <div className="w-1 h-1 bg-blue-500 rounded-full mt-1.5 shrink-0" />
                        <span><strong>열관류율<br />(U-value)</strong>: 낮을수록 단열 성능이 우수하며, 지역+용도+외기접촉 조합에 맞춘 법적 기준이 자동 적용됩니다.</span>
                      </li>
                      <li className="flex gap-2">
                        <div className="w-1 h-1 bg-blue-500 rounded-full mt-1.5 shrink-0" />
                        <span><strong>외기간접<br />접촉</strong>: 외기에 직접 면하지 않는 조건일 경우 직접 대비 1.5배 완화된 U-value 기준이 자동 설정됩니다.</span>
                      </li>
                      <li className="flex gap-2">
                        <div className="w-1 h-1 bg-blue-500 rounded-full mt-1.5 shrink-0" />
                        <span><strong>결로방지<br />(TDR)</strong>: 낮을수록 안전하며, 지역별(중부 0.25, 남부 0.28, 제주 0.30) 법적 기준이 자동 적용됩니다.</span>
                      </li>
                      <li className="flex gap-2">
                        <div className="w-1 h-1 bg-blue-500 rounded-full mt-1.5 shrink-0" />
                        <span><strong>일사열취득률<br />(SHGC)</strong>: 냉난방 에너지 균형을 고려하기 위한 참고용 지표이며 합격 판정에서 제외됩니다.</span>
                      </li>
                    </ul>
                  </Card>
                </aside>
              </motion.div>
            )}

            {/* --- RESULT TAB --- */}
            {tab === "result" && result && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className="md:col-span-1 flex flex-col gap-6">
                    <Card className="flex-1 flex flex-col items-center justify-center text-center py-10">
                      <div className="relative mb-4">
                        <div className={cn(
                          "w-24 h-24 rounded-full flex items-center justify-center text-3xl font-black border-4",
                          result.score >= 8 ? "border-emerald-500 text-emerald-500 bg-emerald-500/10" :
                          result.score >= 5 ? "border-amber-500 text-amber-500 bg-amber-500/10" :
                          "border-rose-500 text-rose-500 bg-rose-500/10"
                        )}>
                          {result.score}/{result.maxScore}
                        </div>
                        {result.score >= 8 && <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-amber-400 animate-pulse" />}
                      </div>
                      <h4 className="text-lg font-bold text-slate-800 dark:text-white">종합 진단 점수</h4>
                      <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">
                        {result.score >= 8 ? "Excellent" : result.score >= 5 ? "Average" : "Critical"}
                      </p>
                    </Card>
                  </div>

                  <Card title="에너지 손실 구조 분석" icon={BarChart3} className="md:col-span-2">
                    <div className="h-[200px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={energyData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {energyData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                          </Pie>
                          <RechartsTooltip 
                            contentStyle={{ backgroundColor: isDarkMode ? '#0f172a' : '#ffffff', border: isDarkMode ? '1px solid #1e293b' : '1px solid #e2e8f0', borderRadius: '8px' }}
                            itemStyle={{ color: isDarkMode ? '#e2e8f0' : '#1e293b', fontSize: '12px' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex justify-center gap-6 mt-2">
                      {energyData.map(d => (
                        <div key={d.name} className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.fill }} />
                          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">{d.name}</span>
                        </div>
                      ))}
                    </div>
                  </Card>

                  <Card title="예상 절감 잠재량" icon={Lightbulb} className="md:col-span-1 border-emerald-500/20 bg-emerald-500/5">
                    <div className="space-y-6 py-2">
                      <div>
                        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">에너지 절감</div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-black text-emerald-500">
                            {aiAnalysis ? <CountUp end={aiAnalysis.energySavingsKwh} /> : "---"}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">kWh/년</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">CO2 저감</div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-black text-blue-500">
                            {aiAnalysis ? <CountUp end={aiAnalysis.co2ReductionKg} /> : "---"}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">kg/년</span>
                        </div>
                      </div>
                      {!aiAnalysis && (
                        <p className="text-[9px] text-slate-500 dark:text-slate-600 leading-tight italic">
                          * 심층 분석을 실행하면 정밀한 절감 수치를 계산합니다.
                        </p>
                      )}
                    </div>
                  </Card>
                </div>

                <div className="mt-2">
                  {aiAnalysis ? (
                    <Card title="진단 요약" icon={Sparkles} className="bg-blue-500/5 border-blue-500/20">
                      <HighlightText 
                        text={aiAnalysis.summary} 
                        className="text-sm leading-relaxed text-slate-900 dark:text-slate-200" 
                      />
                    </Card>
                  ) : (
                    <Card title="진단 요약" icon={Sparkles} className="bg-slate-100 dark:bg-slate-900/40 border-dashed border-slate-200 dark:border-slate-800">
                      <div className="flex flex-col items-center justify-center py-2 text-center">
                        <p className="text-xs text-slate-500 mb-2 italic">
                          심층 분석을 실행하면 맞춤형 진단 요약이 여기에 표시됩니다.
                        </p>
                        <button 
                          onClick={() => setTab("ai")}
                          className="text-[10px] font-black text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                        >
                          심층 분석 탭으로 이동 <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    </Card>
                  )}
                </div>

                {aiAnalysis && (
                  <Card title="전략별 예상 절감 효과" icon={BarChart3} className="bg-blue-500/5 border-blue-500/20">
                    <div className="h-[280px] w-full mt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart 
                          data={aiAnalysis.strategicImprovements} 
                          layout="vertical" 
                          margin={{ left: 10, right: 60, top: 10, bottom: 10 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#1e293b' : '#f1f5f9'} horizontal={false} />
                          <XAxis type="number" hide />
                          <YAxis 
                            dataKey="title" 
                            type="category" 
                            width={140} 
                            tick={{ fill: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 11, fontWeight: 'bold' }}
                            axisLine={false}
                            tickLine={false}
                            interval={0}
                          />
                          <RechartsTooltip 
                            cursor={{ fill: isDarkMode ? '#1e293b' : '#f8fafc', opacity: 0.4 }}
                            allowEscapeViewBox={{ x: true, y: true }}
                            contentStyle={{ backgroundColor: isDarkMode ? '#0f172a' : '#ffffff', border: isDarkMode ? '1px solid #1e293b' : '1px solid #e2e8f0', borderRadius: '8px', zIndex: 50 }}
                            itemStyle={{ color: isDarkMode ? '#e2e8f0' : '#1e293b', fontSize: '11px', fontWeight: 'bold' }}
                          />
                          <Bar dataKey="energySavingsKwh" name="에너지 절감 (kWh)" fill="#10b981" radius={[0, 4, 4, 0]} barSize={14} />
                          <Bar dataKey="co2ReductionKg" name="CO2 저감 (kg)" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={14} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex justify-center gap-4 mt-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="text-[9px] font-bold text-slate-500 uppercase">Energy (kWh)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                        <span className="text-[9px] font-bold text-slate-500 uppercase">CO2 (kg)</span>
                      </div>
                    </div>
                  </Card>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {result.results.map((r: any, i: number) => (
                    <div key={i} className="bg-slate-100/70 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-start gap-4 transition-colors">
                      <div className={cn(
                        "p-2 rounded-lg shrink-0",
                        r.isReference 
                          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" 
                          : r.pass 
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500" 
                            : "bg-rose-500/10 text-rose-600 dark:text-rose-500"
                      )}>
                        {r.isReference ? <Info className="w-5 h-5" /> : r.pass ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">{r.label}</h4>
                          <span className="text-[10px] font-black px-2 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800 text-slate-700 dark:text-slate-400 uppercase">{r.value}</span>
                        </div>
                        <p className="text-xs text-slate-500 mb-2">기준: {r.standard}</p>
                        <p className={cn(
                          "text-[11px] font-medium", 
                          r.isReference 
                            ? "text-blue-600 dark:text-blue-400" 
                            : r.pass 
                              ? "text-emerald-600 dark:text-emerald-400" 
                              : "text-rose-600 dark:text-rose-400"
                        )}>{r.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-center pt-4">
                  <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setTab("ai")}
                    className="flex items-center gap-2 px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black transition-all shadow-lg shadow-blue-900/40 group cursor-pointer"
                  >
                    <Sparkles className="w-5 h-5" />
                    심층 분석 리포트 생성
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </motion.button>
                </div>
              </motion.div>
            )}

            {/* --- AI TAB --- */}
            {tab === "ai" && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                {!aiAnalysis && !isAiLoading && (
                  <div className="text-center py-20 bg-slate-100 dark:bg-slate-900/20 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl">
                    <div className="bg-blue-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                      <Sparkles className="w-8 h-8 text-blue-400" />
                    </div>
                    <h3 className="text-xl font-bold mb-2" style={{ color: "var(--color-text)" }}>지능형 분석</h3>
                    <p className="text-slate-500 text-sm max-w-xs mx-auto mb-8">
                      현재 창호 성능 데이터를 바탕으로 전문적인 개선 전략과 경제적 효과를 분석합니다.
                    </p>
                    <button 
                      onClick={handleAiAnalysis}
                      className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black transition-all"
                    >
                      분석 시작하기
                    </button>
                  </div>
                )}

                {isAiLoading && (
                  <div className="text-center py-20">
                    <RefreshCcw className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-4" />
                    <p className="text-slate-400 font-bold animate-pulse">데이터를 분석 중입니다...</p>
                    <p className="text-slate-500 text-xs mt-2">보다 정밀한 분석을 위해 약 1~2분 정도 소요됩니다</p>
                  </div>
                )}

                {aiAnalysis && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 space-y-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Card title="연간 예상 에너지 절감" icon={BarChart3} className="bg-emerald-500/5 border-emerald-500/20">
                          <div className="flex items-end gap-2">
                            <span className="text-3xl font-black text-emerald-500"><CountUp end={aiAnalysis.energySavingsKwh} /></span>
                            <span className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-1">kWh/년</span>
                          </div>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 font-medium">개선안 적용 시 예상되는 연간 전력 절감량</p>
                        </Card>
                        <Card title="연간 예상 CO2 저감" icon={Wind} className="bg-blue-500/5 border-blue-500/20">
                          <div className="flex items-end gap-2">
                            <span className="text-3xl font-black text-blue-500"><CountUp end={aiAnalysis.co2ReductionKg} /></span>
                            <span className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-1">kg/년</span>
                          </div>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 font-medium">탄소 배출권 거래제 기준 추정치</p>
                        </Card>
                      </div>

                      {/* 계산 근거 각주 */}
                      <div className="px-1 py-2 text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed space-y-0.5">
                        <p>* 에너지 절감량 = (U현재 − U개선) × 창호면적 × 난방도일 × 24 (HDD: 중부1 3,320 / 중부2 2,880 / 남부 1,900 / 제주 1,200 °C·day)</p>
                        <p>* CO2 절감량 = 에너지절감량 × 0.4599 (환경부 전력 배출계수 2022 기준)</p>
                      </div>
                      
                      <Card title="종합 진단 요약" icon={Info}>
                        <HighlightText text={aiAnalysis.summary} className="text-sm leading-relaxed whitespace-pre-wrap text-slate-900 dark:text-slate-200" />
                      </Card>

                      <Card title="전략별 예상 절감 효과" icon={BarChart3} className="bg-blue-500/5 border-blue-500/20">
                        <div className="h-[280px] w-full mt-4">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart 
                              data={aiAnalysis.strategicImprovements} 
                              layout="vertical" 
                              margin={{ left: 10, right: 60, top: 10, bottom: 10 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#1e293b' : '#f1f5f9'} horizontal={false} />
                              <XAxis type="number" hide />
                              <YAxis 
                                dataKey="title" 
                                type="category" 
                                width={140} 
                                tick={{ fill: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 11, fontWeight: 'bold' }}
                                axisLine={false}
                                tickLine={false}
                                interval={0}
                              />
                              <RechartsTooltip 
                                cursor={{ fill: isDarkMode ? '#1e293b' : '#f8fafc', opacity: 0.4 }}
                                allowEscapeViewBox={{ x: true, y: true }}
                                contentStyle={{ backgroundColor: isDarkMode ? '#0f172a' : '#ffffff', border: isDarkMode ? '1px solid #1e293b' : '1px solid #e2e8f0', borderRadius: '8px', zIndex: 50 }}
                                itemStyle={{ color: isDarkMode ? '#e2e8f0' : '#1e293b', fontSize: '11px', fontWeight: 'bold' }}
                              />
                              <Bar dataKey="energySavingsKwh" name="에너지 절감 (kWh)" fill="#10b981" radius={[0, 4, 4, 0]} barSize={14} />
                              <Bar dataKey="co2ReductionKg" name="CO2 저감 (kg)" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={14} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="flex justify-center gap-4 mt-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-emerald-500" />
                            <span className="text-[9px] font-bold text-slate-500 uppercase">Energy (kWh)</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-blue-500" />
                            <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase">CO2 (kg)</span>
                          </div>
                        </div>
                      </Card>

                      <Card title="지표별 심층 분석" icon={Activity}>
                        <HighlightText text={aiAnalysis.detailedAnalysis} className="text-sm leading-relaxed whitespace-pre-wrap text-slate-900 dark:text-slate-200" />
                      </Card>
                    </div>
                    
                    <div className="space-y-6">
                      <Card title="추천 개선 전략" icon={Lightbulb} className="bg-blue-500/5 border-blue-500/20">
                        <ul className="space-y-4">
                          {aiAnalysis.strategicImprovements.map((imp, i) => (
                            <li key={i} className="flex gap-3">
                              <div className="w-5 h-5 rounded-full bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">{i+1}</div>
                              <div className="space-y-1">
                                <div className="text-xs font-black text-slate-800 dark:text-white">{imp.title}</div>
                                <div className="text-[11px] text-slate-900 dark:text-slate-400 leading-relaxed">{imp.description}</div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </Card>
                      
                      <Card title="기대 효과" icon={BarChart3}>
                        <p className="text-xs text-slate-900 dark:text-slate-400 leading-relaxed italic">"{aiAnalysis.economicImpact}"</p>
                      </Card>

                      {/* PDF Report Download Button */}
                      <motion.button
                        whileHover={!isPdfGenerating ? { scale: 1.02 } : {}}
                        whileTap={!isPdfGenerating ? { scale: 0.98 } : {}}
                        onClick={!isPdfGenerating ? handleDownloadPdf : undefined}
                        className={cn(
                          "w-full py-4 font-black rounded-2xl shadow-xl flex items-center justify-center gap-3 transition-all cursor-pointer",
                          isPdfGenerating 
                            ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50"
                            : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20"
                        )}
                      >
                        {isPdfGenerating ? (
                          <RefreshCcw className="w-5 h-5 animate-spin" />
                        ) : (
                          <Download className="w-5 h-5" />
                        )}
                        {isPdfGenerating ? "PDF 생성 중..." : "📄 PDF 리포트 다운로드"}
                      </motion.button>

                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setTab("recommend")}
                        className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black rounded-2xl shadow-xl shadow-blue-900/20 flex items-center justify-center gap-3 transition-all group cursor-pointer"
                      >
                        <Database className="w-5 h-5" />
                        최적 교체 제품 확인하기
                        <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                      </motion.button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* --- RECOMMEND TAB --- */}
            {tab === "recommend" && result && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--color-text)" }}>
                    <Database className="w-5 h-5 text-blue-500" />
                    최적 교체 제품 추천
                  </h3>
                  <div className="flex items-center gap-3">
                    {selectedProducts.length > 0 && (
                      <button
                        onClick={() => setShowCompareModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-900/40 cursor-pointer"
                      >
                        <Activity className="w-3.5 h-3.5" />
                        {selectedProducts.length}개 제품 비교하기
                      </button>
                    )}
                    {!isProductsLoading && (
                      <span className="text-xs font-bold" style={{ color: "var(--color-text-sub)" }}>
                        <CountUp end={supabaseProducts.length} />개 제품 발견
                      </span>
                    )}
                  </div>
                </div>

                {/* 로딩 스피너 */}
                {isProductsLoading && (
                  <div className="py-20 text-center bg-slate-100 dark:bg-slate-900/20 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                    <RefreshCcw className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-4" />
                    <p className="text-slate-400 font-bold animate-pulse">Supabase에서 추천 제품을 불러오는 중...</p>
                    <p className="text-xs text-slate-600 mt-2">열관류율 ≤ {Math.min(input.uValue, thresholds.uValue).toFixed(2)} W/m²·K 기준으로 검색 중</p>
                  </div>
                )}

                {/* 에러 표시 */}
                {productsError && !isProductsLoading && (
                  <div className="py-16 text-center bg-rose-500/5 border border-rose-500/20 rounded-2xl">
                    <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto mb-4" />
                    <p className="text-rose-400 font-bold mb-2">제품 데이터를 불러올 수 없습니다</p>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">{productsError}</p>
                    <button
                      onClick={handleRunAnalysis}
                      className="mt-4 px-6 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition-all"
                    >
                      다시 시도
                    </button>
                  </div>
                )}

                {/* 제품 목록 */}
                {!isProductsLoading && !productsError && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {supabaseProducts.length === 0 ? (
                      input.uValue <= (REGION_U_LIMITS[input.region] || 1.0) ? (
                        <div className="col-span-full py-20 text-center bg-slate-100 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-2xl">
                          <XCircle className="w-10 h-10 text-slate-700 mx-auto mb-4" />
                          <p className="text-slate-500 font-bold">현재 창호가 이미 에절기 기준을 충족합니다</p>
                          <p className="text-xs text-slate-600 mt-2">입력하신 U-value가 해당 지역의 에너지절약설계기준을 충족하여 더 나은 대체 제품이 없습니다.</p>
                        </div>
                      ) : (
                        <div className="col-span-full py-20 text-center bg-slate-100 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-2xl">
                          <XCircle className="w-10 h-10 text-slate-700 mx-auto mb-4" />
                          <p className="text-slate-500 font-bold">조건에 맞는 제품을 찾지 못했습니다.</p>
                          <p className="text-xs text-slate-600 mt-2">프레임 재질 조건을 '전체'로 변경해보세요.</p>
                        </div>
                      )
                    ) : (
                      supabaseProducts.map((p: any, i: number) => {
                        const gradeColors: Record<number, string> = {
                          1: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
                          2: "bg-blue-500/20 text-blue-400 border-blue-500/30",
                          3: "bg-amber-500/20 text-amber-400 border-amber-500/30",
                          4: "bg-orange-500/20 text-orange-400 border-orange-500/30",
                          5: "bg-rose-500/20 text-rose-400 border-rose-500/30",
                        };
                        const grade = p.효율등급 || 0;
                        const gradeStyle = gradeColors[grade] || "bg-slate-800 text-slate-400 border-slate-700";

                        return (
                          <motion.div
                            key={p.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.05 }}
                            onClick={() => toggleProductSelection(p.id)}
                            className={cn(
                              "group relative rounded-2xl p-5 transition-all cursor-pointer border hover:border-blue-400 dark:hover:border-blue-500/50 hover:shadow-lg hover:shadow-slate-200/50 dark:hover:shadow-none",
                              i === 0 && "ring-2 ring-blue-500/20 border-blue-300 dark:border-blue-500/30",
                              selectedProducts.includes(p.id)
                                ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10"
                                : "bg-white dark:bg-slate-900/40 border-slate-200 dark:border-slate-800"
                            )}
                          >
                            {/* 선택 체크박스 */}
                            <div className="absolute top-4 right-4">
                              <div className={cn(
                                "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                                selectedProducts.includes(p.id) ? "bg-blue-500 border-blue-500" : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                              )}>
                                {selectedProducts.includes(p.id) && <CheckCircle2 className="w-3 h-3 text-white" />}
                              </div>
                            </div>

                            {/* BEST MATCH 뱃지 */}
                            {i === 0 && (
                              <div className="absolute -top-3 left-4 text-white text-[10px] font-black px-3 py-1 rounded-full flex items-center gap-1 shadow-lg" style={{ backgroundColor: "var(--color-primary)" }}>
                                <Sparkles className="w-3 h-3" />
                                BEST MATCH
                              </div>
                            )}

                            {/* 업체명 & 모델명 */}
                            <div className="flex justify-between items-start mb-3 pr-6">
                              <div>
                                <h4 className="text-lg font-black text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{p.모델명 || "모델명 없음"}</h4>
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{p.업체명 || "업체명 없음"} · {p.프레임재질 || "-"}</p>
                              </div>
                              {/* 효율등급 뱃지 */}
                              <span className={cn(
                                "text-xs font-black px-2.5 py-1 rounded-lg border",
                                gradeStyle
                              )}>
                                {grade}등급
                              </span>
                            </div>

                            {/* 열관류율 (U-value) 하이라이트 */}
                            <div className="bg-slate-50 dark:bg-slate-950/60 rounded-xl p-3 mb-3 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Thermometer className="w-4 h-4 text-blue-400" />
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">열관류율 (U-value)</span>
                              </div>
                              <span className="text-lg font-black text-blue-600 dark:text-blue-400">{p.열관류율} <span className="text-[10px] font-bold text-slate-500">W/m²·K</span></span>
                            </div>

                            {/* 유리구성 / 로이여부 / 충전기체 */}
                            <div className="grid grid-cols-3 gap-2 mb-4">
                              <div className="bg-slate-100 dark:bg-slate-950/60 rounded-lg p-2 text-center">
                                <div className="text-[9px] font-bold text-slate-400 dark:text-slate-600 uppercase mb-0.5">유리구성</div>
                                <div className="text-xs font-black text-slate-700 dark:text-slate-300">{p.유리구성 || "-"}</div>
                              </div>
                              <div className="bg-slate-100 dark:bg-slate-950/60 rounded-lg p-2 text-center">
                                <div className="text-[9px] font-bold text-slate-400 dark:text-slate-600 uppercase mb-0.5">로이코팅</div>
                                <div className={cn(
                                  "text-xs font-black",
                                  p.로이여부 ? "text-emerald-400" : "text-slate-500"
                                )}>
                                  {p.로이여부 ? "적용" : "미적용"}
                                </div>
                              </div>
                              <div className="bg-slate-100 dark:bg-slate-950/60 rounded-lg p-2 text-center">
                                <div className="text-[9px] font-bold text-slate-400 dark:text-slate-600 uppercase mb-0.5">충전기체</div>
                                <div className="text-xs font-black text-slate-700 dark:text-slate-300">{p.충전기체 || "-"}</div>
                              </div>
                            </div>

                            {/* 적용 버튼 */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const nextInput = {
                                  ...input,
                                  uValue: p.열관류율,
                                  glassConfig: p.유리구성 === "삼중" ? "triple" : p.유리구성 === "복층" ? "double" : "single",
                                  loweCoating: p.로이여부 ? "yes" : "no"
                                };
                                setInput(nextInput);
                                setTab("input");
                                setTimeout(() => {
                                  handleRunAnalysis(nextInput);
                                }, 300);
                              }}
                              className="w-full py-2 text-xs font-bold rounded-lg transition-all bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-[#2563EB] hover:text-white cursor-pointer"
                            >
                              스펙 적용
                            </button>
                            <p className="text-[9px] text-slate-400 dark:text-slate-500 text-center mt-2 leading-relaxed">
                              기밀성 등급과 TDR은 인증 DB에 포함되지 않아 기존 입력값이 유지됩니다.
                            </p>
                          </motion.div>
                        );
                      })
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {/* --- STATS TAB --- */}
            {tab === "stats" && (
              <StatsTab isDarkMode={isDarkMode} />
            )}
          </AnimatePresence>
        </main>

        {/* Comparison Modal */}
        <AnimatePresence>
          {showCompareModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowCompareModal(false)}
                className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden"
              >
                <div className="p-6 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-950 flex items-center justify-between">
                  <h3 className="text-xl font-black text-[#0F172A] dark:text-white flex items-center gap-3">
                    <Activity className="w-6 h-6 text-blue-600 dark:text-blue-500" />
                    제품 성능 비교 분석
                  </h3>
                  <button 
                    onClick={() => setShowCompareModal(false)}
                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                  >
                    <XCircle className="w-6 h-6 text-slate-400 dark:text-slate-500" />
                  </button>
                </div>
                
                <div className="p-6 overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr>
                        <th className="p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC]/50 dark:bg-slate-900/20">성능 지표</th>
                        {compareList.map((p: any) => (
                          <th key={p.id} className="p-4 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC]/50 dark:bg-slate-900/20">
                            <div className="text-sm font-black text-slate-900 dark:text-white">{p.모델명}</div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase">{p.업체명}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      {[
                        { label: "열관류율 (U-value)", key: "열관류율", unit: "W/m²·K" },
                        { label: "효율등급", key: "효율등급", unit: "등급" },
                        { label: "유리구성", key: "유리구성", unit: "" },
                        { label: "로이코팅", key: "로이여부", unit: "" },
                        { label: "충전기체", key: "충전기체", unit: "" },
                        { label: "프레임 재질", key: "프레임재질", unit: "" },
                      ].map((row) => (
                        <tr key={row.key} className="hover:bg-slate-100 dark:hover:bg-slate-850/40 even:bg-[#F1F5F9] dark:even:bg-slate-950/20 transition-colors">
                          <td className="p-4 font-bold text-slate-500 dark:text-slate-400 border-b border-r border-slate-200/60 dark:border-slate-800/60 bg-[#F8FAFC]/30 dark:bg-slate-900/10">{row.label}</td>
                          {compareList.map((p: any) => {
                            const isUValue = row.key === "열관류율";
                            return (
                              <td key={p.id} className={cn(
                                "p-4 border-b border-slate-200/60 dark:border-slate-800/50 font-medium text-slate-800 dark:text-slate-200",
                                isUValue ? "text-lg font-black text-[#2563EB] dark:text-blue-400 bg-blue-50/10 dark:bg-blue-950/10" : ""
                              )}>
                                {row.key === "로이여부" ? (p[row.key] ? "적용" : "미적용") : (p[row.key] || "-")}{row.key !== "로이여부" ? row.unit : ""}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="p-6 bg-[#F8FAFC] dark:bg-slate-950/40 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3">
                  <button 
                    onClick={handleResetSelection}
                    className="px-4 py-2 text-xs font-bold rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    선택 초기화
                  </button>
                  <button 
                    onClick={() => setShowCompareModal(false)}
                    className="px-6 py-2 bg-[#2563EB] dark:bg-slate-800 hover:bg-blue-700 dark:hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md shadow-blue-500/10 dark:shadow-none"
                  >
                    닫기
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Toast Notification */}
        <AnimatePresence>
          {toastMessage && (
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.9, x: "-50%" }}
              animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
              exit={{ opacity: 0, y: 20, scale: 0.9, x: "-50%" }}
              className="fixed bottom-6 left-1/2 z-[200] bg-slate-900/90 dark:bg-white/95 text-white dark:text-slate-900 px-5 py-3 rounded-xl shadow-2xl flex items-center gap-2 border border-slate-850 dark:border-slate-200 backdrop-blur-sm"
            >
              <CheckCircle2 className="w-4 h-4 text-blue-500 dark:text-blue-600" />
              <span className="text-xs font-bold">{toastMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <footer className="mt-20 pt-8 border-t border-slate-900 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
            © 2026 WinEnergy Analysis Tool by Sohee Shim
          </div>
        </footer>
      </div>

      {/* PDF Export Hidden Template */}
      <div 
        style={{ position: 'absolute', left: '-9999px', top: '-9999px', width: '800px' }}
        className="pdf-report-wrapper text-slate-900 bg-white"
      >
        <style dangerouslySetInnerHTML={{ __html: `
          .pdf-report-wrapper, .pdf-report-wrapper * {
            font-family: sans-serif !important;
          }
          
          /* Override text colors to prevent oklch parsing in html2canvas */
          .pdf-report-wrapper .text-slate-900 { color: #0f172a !important; }
          .pdf-report-wrapper .text-slate-800 { color: #1e293b !important; }
          .pdf-report-wrapper .text-slate-700 { color: #334155 !important; }
          .pdf-report-wrapper .text-slate-650 { color: #475569 !important; }
          .pdf-report-wrapper .text-slate-600 { color: #475569 !important; }
          .pdf-report-wrapper .text-slate-500 { color: #64748b !important; }
          .pdf-report-wrapper .text-slate-400 { color: #94a3b8 !important; }
          .pdf-report-wrapper .text-slate-300 { color: #cbd5e1 !important; }
          
          .pdf-report-wrapper .text-blue-750 { color: #1d4ed8 !important; }
          .pdf-report-wrapper .text-blue-700 { color: #1d4ed8 !important; }
          .pdf-report-wrapper .text-blue-600 { color: #2563eb !important; }
          .pdf-report-wrapper .text-blue-500 { color: #3b82f6 !important; }
          .pdf-report-wrapper .text-blue-400 { color: #60a5fa !important; }
          
          .pdf-report-wrapper .text-emerald-700 { color: #047857 !important; }
          .pdf-report-wrapper .text-emerald-600 { color: #059669 !important; }
          .pdf-report-wrapper .text-emerald-500 { color: #10b981 !important; }
          .pdf-report-wrapper .text-emerald-400 { color: #34d399 !important; }
          
          .pdf-report-wrapper .text-rose-700 { color: #b91c1c !important; }
          .pdf-report-wrapper .text-rose-600 { color: #e11d48 !important; }
          .pdf-report-wrapper .text-rose-500 { color: #f43f5e !important; }
          .pdf-report-wrapper .text-rose-400 { color: #fb7185 !important; }
          
          /* Override background colors */
          .pdf-report-wrapper .bg-white { background-color: #ffffff !important; }
          .pdf-report-wrapper .bg-slate-50 { background-color: #f8fafc !important; }
          .pdf-report-wrapper .bg-slate-100 { background-color: #f1f5f9 !important; }
          .pdf-report-wrapper .bg-slate-200 { background-color: #e2e8f0 !important; }
          .pdf-report-wrapper .bg-slate-800 { background-color: #1e293b !important; }
          
          .pdf-report-wrapper .bg-blue-50 { background-color: #eff6ff !important; }
          .pdf-report-wrapper .bg-blue-50\\/50 { background-color: rgba(239, 246, 255, 0.5) !important; }
          .pdf-report-wrapper .bg-blue-500\\/10 { background-color: rgba(59, 130, 246, 0.1) !important; }
          .pdf-report-wrapper .bg-blue-550\\/10 { background-color: rgba(59, 130, 246, 0.1) !important; }
          .pdf-report-wrapper .bg-blue-500\\/20 { background-color: rgba(59, 130, 246, 0.2) !important; }
          
          .pdf-report-wrapper .bg-emerald-50 { background-color: #ecfdf5 !important; }
          .pdf-report-wrapper .bg-emerald-550\\/10 { background-color: rgba(16, 185, 129, 0.1) !important; }
          .pdf-report-wrapper .bg-emerald-550-10 { background-color: rgba(16, 185, 129, 0.1) !important; }
          .pdf-report-wrapper .bg-emerald-50\\/50 { background-color: rgba(236, 253, 245, 0.5) !important; }
          .pdf-report-wrapper .bg-emerald-500 { background-color: #10b981 !important; }
          .pdf-report-wrapper .bg-emerald-500\\/10 { background-color: rgba(16, 185, 129, 0.1) !important; }
          .pdf-report-wrapper .bg-emerald-500\\/20 { background-color: rgba(16, 185, 129, 0.2) !important; }
          
          .pdf-report-wrapper .bg-amber-500 { background-color: #f59e0b !important; }
          
          .pdf-report-wrapper .bg-rose-50 { background-color: #fff1f2 !important; }
          .pdf-report-wrapper .bg-rose-500 { background-color: #ef4444 !important; }
          .pdf-report-wrapper .bg-rose-500\\/10 { background-color: rgba(244, 63, 94, 0.1) !important; }
          .pdf-report-wrapper .bg-rose-500\\/20 { background-color: rgba(244, 63, 94, 0.2) !important; }
          
          /* Override borders */
          .pdf-report-wrapper .border-slate-100 { border-color: #f1f5f9 !important; }
          .pdf-report-wrapper .border-slate-200 { border-color: #e2e8f0 !important; }
          .pdf-report-wrapper .border-slate-800 { border-color: #1e293b !important; }
          .pdf-report-wrapper .border-slate-900 { border-color: #0f172a !important; }
          .pdf-report-wrapper .border-blue-100 { border-color: #dbeafe !important; }
          .pdf-report-wrapper .border-blue-200 { border-color: #bfdbfe !important; }
          .pdf-report-wrapper .border-emerald-100 { border-color: #a7f3d0 !important; }
          .pdf-report-wrapper .border-rose-100 { border-color: #fecdd3 !important; }
        ` }} />
        {/* PAGE 1: COVER */}
        <div 
          id="pdf-page-cover"
          style={{ width: '800px', height: '1130px' }}
          className="relative flex flex-col justify-between p-16 bg-white border border-slate-200 box-border overflow-hidden"
        >
          {/* Blueprint Grid Accent */}
          <div className="absolute inset-0 opacity-[0.025] pointer-events-none flex flex-wrap border-b border-r border-blue-500">
            {Array.from({ length: 120 }).map((_, i) => (
              <div key={i} style={{ width: '40px', height: '40px' }} className="border-t border-l border-blue-500 shrink-0" />
            ))}
          </div>
          
          <div className="flex justify-between items-center border-b-2 border-slate-900 pb-4">
            <span className="text-xs font-bold tracking-[0.25em] text-slate-500 uppercase">WinEnergy Intelligence</span>
            <span className="text-xs font-bold text-slate-400">REPORT NO. WE-{new Date().getFullYear()}-{Math.floor(1000 + Math.random() * 9000)}</span>
          </div>

          <div className="my-auto space-y-8">
            <div className="space-y-4">
              <div className="inline-flex px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold tracking-wider rounded-full border border-blue-100">
                창호 에너지 효율 및 법적 기준 요건 진단
              </div>
              <h1 className="text-5xl font-black tracking-tight text-slate-900 leading-tight">
                WinEnergy<br />
                Analysis Tool
              </h1>
              <p className="text-lg text-slate-500 font-medium">
                국토교통부 고시 최신 에너지절약설계기준 기반 분석 보고서
              </p>
            </div>

            <div className="h-[2px] w-20 bg-blue-600" />

            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-8 space-y-4 max-w-xl">
              <div className="grid grid-cols-3 gap-y-4 text-sm">
                <div className="text-slate-400 font-bold">진단 일시</div>
                <div className="col-span-2 text-slate-800 font-black">
                  {new Date().toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>

                <div className="text-slate-400 font-bold">분석 지역</div>
                <div className="col-span-2 text-slate-800 font-black">
                  {result && (REGIONS as any)[input.region]?.name} ({(REGIONS as any)[input.region]?.code})
                </div>

                <div className="text-slate-400 font-bold">건물 용도</div>
                <div className="col-span-2 text-slate-800 font-black">
                  {input.buildingType === "residential_apartment" ? "주거 (공동주택)" : input.buildingType === "residential_house" ? "주거 (단독주택)" : "비주거"}
                </div>

                <div className="text-slate-400 font-bold">외기 접촉</div>
                <div className="col-span-2 text-slate-800 font-black">
                  {input.contactType === "direct" ? "외기 직접 접촉" : "외기 간접 접촉"}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 border-t border-slate-100 pt-6">
            <span>CONFIDENTIAL • INTERNAL USE ONLY</span>
            <span>© 2026 WinEnergy Analysis Tool by Sohee Shim</span>
          </div>
        </div>

        {/* PAGE 2: INPUT DATA */}
        <div 
          id="pdf-page-input"
          style={{ width: '800px', height: '1130px' }}
          className="relative flex flex-col justify-between p-16 bg-white border border-slate-200 box-border overflow-hidden"
        >
          <div className="flex justify-between items-center border-b border-slate-100 pb-4">
            <span className="text-xs font-bold text-slate-400">1. 입력 데이터 및 설계 조건</span>
            <span className="text-xs font-bold text-blue-600">WinEnergy Report</span>
          </div>

          <div className="flex-1 my-8 space-y-8">
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-slate-900">1. 입력 데이터 및 설계 환경 설정</h2>
              <p className="text-xs text-slate-400">
                사용자가 입력한 창호 성능 사양 및 설계 기상 환경의 상세 명세입니다. 해당 정보는 법적 한계값 기준 계산에 활용됩니다.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 space-y-3">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">기본 환경 설정</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">분석 지역</span>
                    <span className="text-slate-800 font-bold">{(REGIONS as any)[input.region]?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">건물 용도</span>
                    <span className="text-slate-800 font-bold">
                      {input.buildingType === "residential_apartment" ? "주거 (공동주택)" : input.buildingType === "residential_house" ? "주거 (단독주택)" : "비주거"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">외기 접촉 구분</span>
                    <span className="text-slate-800 font-bold">{input.contactType === "direct" ? "외기직접" : "외기간접"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">창호 면적</span>
                    <span className="text-slate-800 font-bold">{input.area} m²</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">프레임 재질</span>
                    <span className="text-slate-800 font-bold">{FRAME_LABELS[input.frame] || input.frame}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 space-y-3">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">입력 성능 사양</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">열관류율 (U-Value)</span>
                    <span className="text-slate-800 font-bold">{input.uValue} W/m²K</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">일사열취득률 (SHGC)</span>
                    <span className="text-slate-800 font-bold">{input.shgc}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">기밀성 등급</span>
                    <span className="text-slate-800 font-bold">{input.airtight}등급</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">결로방지성능 (TDR)</span>
                    <span className="text-slate-800 font-bold">{input.tdr}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-5 space-y-2">
              <h3 className="text-xs font-black text-blue-800">지역별 설계 에너지 조건 정보</h3>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                대한민국 국토교통부 「건축물의 에너지절약설계기준」에 의거, 기후적 열손실 강도에 따라 전국을 중부1지역, 중부2지역, 남부지역, 제주도로 분류합니다. 입력 사양은 해당 지역의 법적 최소 열관류율(U-value) 및 온도차이비율(TDR) 기준값에 의해 적합 판정이 결정됩니다.
              </p>
            </div>
          </div>

          <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 border-t border-slate-100 pt-6">
            <span>WinEnergy Analysis Report</span>
            <span>Page 1 of 4</span>
          </div>
        </div>

        {/* PAGE 3: SCORE & RESULTS */}
        <div 
          id="pdf-page-score"
          style={{ width: '800px', height: '1130px' }}
          className="relative flex flex-col justify-between p-16 bg-white border border-slate-200 box-border overflow-hidden"
        >
          <div className="flex justify-between items-center border-b border-slate-100 pb-4">
            <span className="text-xs font-bold text-slate-400">2. 종합 진단 점수 및 항목별 결과</span>
            <span className="text-xs font-bold text-blue-600">WinEnergy Report</span>
          </div>

          <div className="flex-1 my-8 space-y-8">
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-slate-900">2. 종합 진단 점수 및 법적 요건 만족도</h2>
              <p className="text-xs text-slate-400">
                지정된 법적 규제 조건에 따른 주요 에너지 항목별 준수율과 종합 진단 등급을 요약합니다.
              </p>
            </div>

            {result && (
              <div className="flex items-center gap-8 bg-slate-50 border border-slate-100 rounded-2xl p-6">
                <div className="w-28 h-28 rounded-full border-[10px] border-blue-500/10 flex flex-col items-center justify-center bg-white shadow-sm shrink-0">
                  <span className="text-3xl font-black text-slate-800">{result.score}</span>
                  <span className="text-[10px] font-bold text-slate-400 border-t border-slate-100 w-12 text-center pt-0.5">/ 10 점</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "px-2.5 py-0.5 rounded-full text-xs font-black uppercase text-white",
                      result.score >= 8 ? "bg-emerald-500" : result.score >= 5 ? "bg-amber-500" : "bg-rose-500"
                    )}>
                      {result.grade}
                    </span>
                    <span className="text-xs font-bold text-slate-400">등급 판정</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed font-medium">
                    {result.score >= 8 
                      ? "종합 진단 기준(열관류율, 기밀성, 결로방지, 유리구성 등)을 훌륭히 만족하여 우수한 에너지 성능을 확보했습니다." 
                      : result.score >= 5 
                        ? "일부 설계 요소를 충족하였으나 특정 취약 항목이 존재하므로 단열 보강 및 제품 교체를 권장합니다." 
                        : "주요 단열 및 결로방지 성능이 기준에 크게 미치지 못해, 에너지 효율이 극히 저조하고 하자 발생 위험이 큽니다."}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <h3 className="text-sm font-black text-slate-800">세부 항목별 진단 명세</h3>
              <div className="space-y-3">
                {result && result.results.map((r: any, idx: number) => (
                  <div key={idx} className="border border-slate-100 rounded-xl p-4 flex justify-between items-center bg-white shadow-sm">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-800">{r.label}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{r.value}</span>
                      </div>
                      <p className="text-[10px] text-slate-400">기준: {r.standard}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500">{r.detail}</span>
                      <span className={cn(
                        "text-[10px] font-black px-2 py-0.5 rounded",
                        r.isReference 
                          ? "bg-blue-50 text-blue-600 border border-blue-100" 
                          : r.pass 
                            ? "bg-emerald-50 text-emerald-600 border border-emerald-100" 
                            : "bg-rose-50 text-rose-600 border border-rose-100"
                      )}>
                        {r.isReference ? "참고" : r.pass ? "합격" : "불합격"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 border-t border-slate-100 pt-6">
            <span>WinEnergy Analysis Report</span>
            <span>Page 2 of 4</span>
          </div>
        </div>

        {/* PAGE 4: AI ANALYSIS */}
        <div 
          id="pdf-page-ai"
          style={{ width: '800px', height: '1130px' }}
          className="relative flex flex-col justify-between p-16 bg-white border border-slate-200 box-border overflow-hidden"
        >
          <div className="flex justify-between items-center border-b border-slate-100 pb-4">
            <span className="text-xs font-bold text-slate-400">3. 지능형 에너지 성능 분석 리포트</span>
            <span className="text-xs font-bold text-blue-600">WinEnergy Report</span>
          </div>

          <div className="flex-1 my-8 space-y-6 overflow-hidden">
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-slate-900">3. AI 지능형 종합 성능 분석 및 개선 제안</h2>
              <p className="text-xs text-slate-400">
                창호 에너지 진단 데이터를 기초로 거대언어모델(LLM)이 분석한 연간 절감 효과 및 기술 개선 전략입니다.
              </p>
            </div>

            {aiAnalysis && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-4 flex justify-between items-center">
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase">예상 연간 에너지 절감</div>
                      <div className="text-xl font-black text-emerald-600 mt-1">{aiAnalysis.energySavingsKwh.toLocaleString()} kWh/년</div>
                    </div>
                    <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg">
                      <BarChart3 className="w-5 h-5" />
                    </div>
                  </div>

                  <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 flex justify-between items-center">
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase">예상 연간 CO2 저감</div>
                      <div className="text-xl font-black text-blue-600 mt-1">{aiAnalysis.co2ReductionKg.toLocaleString()} kg/년</div>
                    </div>
                    <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg">
                      <Wind className="w-5 h-5" />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-black text-slate-800">종합 진단 요약</h3>
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                    <p className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap">{aiAnalysis.summary}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-black text-slate-800">추천 개선 전략</h3>
                  <div className="grid grid-cols-1 gap-2.5">
                    {aiAnalysis.strategicImprovements.slice(0, 3).map((imp, idx) => (
                      <div key={idx} className="border border-slate-100 rounded-xl p-3 flex gap-3 bg-white">
                        <div className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-100 flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">{idx + 1}</div>
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold text-slate-800">{imp.title}</div>
                          <div className="text-[10px] text-slate-500 leading-relaxed">{imp.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-black text-slate-800">기대 경제 효과</h3>
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-3.5 italic text-[11px] text-slate-500 text-center leading-relaxed">
                    "{aiAnalysis.economicImpact}"
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 border-t border-slate-100 pt-6">
            <span>WinEnergy Analysis Report</span>
            <span>Page 3 of 4</span>
          </div>
        </div>

        {/* PAGE 5: RECOMMENDED PRODUCTS */}
        <div 
          id="pdf-page-products"
          style={{ width: '800px', height: '1130px' }}
          className="relative flex flex-col justify-between p-16 bg-white border border-slate-200 box-border overflow-hidden"
        >
          <div className="flex justify-between items-center border-b border-slate-100 pb-4">
            <span className="text-xs font-bold text-slate-400">4. 에너지 기준 충족 추천 제품</span>
            <span className="text-xs font-bold text-blue-600">WinEnergy Report</span>
          </div>

          <div className="flex-1 my-8 space-y-6">
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-slate-900">4. 에너지 등급 우수 추천 제품 (Top 5)</h2>
              <p className="text-xs text-slate-400">
                입력하신 조건 및 법적 에너지 설계 요건을 완벽하게 만족하고 에너지를 최소화할 수 있는 데이터베이스 내 고성능 창세트 목록입니다.
              </p>
            </div>

            <div className="overflow-hidden border border-slate-100 rounded-xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-400 border-b border-slate-100">
                    <th className="p-3 font-bold">순위</th>
                    <th className="p-3 font-bold">제조사</th>
                    <th className="p-3 font-bold">모델명</th>
                    <th className="p-3 font-bold text-center">유리 구성</th>
                    <th className="p-3 font-bold text-right">열관류율</th>
                    <th className="p-3 font-bold text-center">기밀성</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {supabaseProducts && supabaseProducts.length > 0 ? (
                    supabaseProducts.slice(0, 5).map((p: any, idx: number) => (
                      <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-3 text-slate-500 font-bold">{idx + 1}</td>
                        <td className="p-3 text-slate-800 font-bold">{p.업체명 || p.manufacturer || "-"}</td>
                        <td className="p-3 text-slate-800 font-bold max-w-[200px] truncate">{p.모델명 || p.modelName || "-"}</td>
                        <td className="p-3 text-slate-500 text-center text-[10px]">{p.유리구성 || p.glassStructure || "-"}</td>
                        <td className="p-3 text-blue-600 font-black text-right">{p.열관류율 || p.uValue || "-"} W/m²K</td>
                        <td className="p-3 text-slate-500 text-center font-bold">{p.기밀성 || p.airtightness || "-"}등급</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">
                        현재 검색 조건을 충족하는 고성능 우수 추천 제품이 존재하지 않습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-[10px] text-slate-400 space-y-1">
              <p className="font-bold text-slate-500">• 제품 정보 안내</p>
              <p>본 보고서에 나열된 제품들은 한국에너지공단에 정식 등록된 창세트 데이터베이스를 바탕으로 실시간 추출된 상위 고성능 모델들입니다.</p>
              <p>열관류율 단위는 W/m²·K이며, 수치가 낮을수록 열손실을 효과적으로 방지하는 우수한 단열 성능을 가집니다.</p>
            </div>
          </div>

          <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 border-t border-slate-100 pt-6">
            <span>WinEnergy Analysis Report</span>
            <span>Page 4 of 4</span>
          </div>
        </div>
      </div>
          </motion.div>
        )}
      </AnimatePresence>
      <WindowChatbot />
    </div>
  );
}

export default App;
