import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const uwThreshold = 1.0;

  // Query 1: 유리구성 = '삼중', 충전기체 = '전체', 프레임재질 = '전체'
  console.log('--- Test: 유리구성=삼중, 충전기체=전체, 프레임재질=전체 ---');
  let query = supabase.from('products').select('*').lte('열관류율', uwThreshold);
  query = query.eq('유리구성', '삼중');
  query = query.order('열관류율', { ascending: true }).limit(5);
  const { data, error } = await query;
  if (error) {
    console.error(error);
  } else {
    console.log(data.map(p => ({
      모델명: p.모델명,
      열관류율: p.열관류율,
      유리구성: p.유리구성,
      충전기체: p.충전기체,
      프레임재질: p.프레임재질
    })));
  }
}

run();
