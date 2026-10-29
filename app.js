/* ランニング手帳 — standalone version. All data stays on this phone (localStorage). No AI service is used. */
"use strict";
const APP_VERSION = "1.7";

/* ---------- constants ---------- */
const TYPES = {
  easy:{label:"イージー",cls:"t-easy"}, recovery:{label:"リカバリー",cls:"t-recovery"},
  long:{label:"ロング",cls:"t-long"}, threshold:{label:"閾値走",cls:"t-threshold"},
  interval:{label:"インターバル",cls:"t-interval"}, race:{label:"レースペース",cls:"t-race"},
  rest:{label:"休養",cls:"t-rest"}
};
const POINT = new Set(["long","threshold","interval","race"]);
const RPE_CAP = ["とても楽","楽","楽","やや楽","ややきつい","ややきつい","きつい","かなりきつい","非常にきつい","限界"];
const FATIGUE_CAP = ["元気","少し疲れ","疲れ","かなり疲れ","限界"];
const HOLIDAYS = new Set(["2026-10-12","2026-11-03","2026-11-23","2027-01-01","2027-01-11","2027-02-11","2027-02-23","2027-03-22","2027-04-29","2027-05-03","2027-05-04","2027-05-05"]);
const EST_MAX_HR = 197;            // 220 - 23歳（推定）
const EASY_HR_LIMIT = Math.round(EST_MAX_HR * 0.80);
const DEFAULT_EASY = [400, 430];   // 6:40-7:10 /km（推定）
const STORE_KEY = "runbook.v1";

/* ---------- date helpers (JST, 5:00 cutoff) ---------- */
const pad = n => String(n).padStart(2,"0");
const key = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
const fromKey = k => { const [y,m,d] = k.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)); };
const addDays = (k,n) => { const d = fromKey(k); d.setUTCDate(d.getUTCDate()+n); return key(d); };
const dow = k => (fromKey(k).getUTCDay()+6)%7; // 0 = Mon
const mondayOf = k => addDays(k,-dow(k));
const logicalToday = () => key(new Date(Date.now() + 4*3600e3)); // JST(+9) − 5h
const jstNowText = () => { const d = new Date(Date.now()+9*3600e3); return `${key(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
function logicalDateOf(start){
  const m = String(start||"").match(/(\d{4})\D(\d{1,2})\D(\d{1,2})\D+(\d{1,2}):(\d{2})/);
  if(!m) return null;
  let k = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if(+m[4] < 5) k = addDays(k,-1);
  return k;
}
const md = k => { const d = fromKey(k); return `${d.getUTCMonth()+1}/${d.getUTCDate()}`; };
const WD = ["月","火","水","木","金","土","日"];
const mdw = k => `${md(k)}(${WD[dow(k)]})`;
const fmtPace = s => s ? `${Math.floor(s/60)}'${pad(Math.round(s%60))}"` : "—";
const paceTxt = s => `${Math.floor(s/60)}:${pad(Math.round(s%60))}`;
const fmtDur = s => { if(!s) return "—"; s=Math.round(s); const h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; };
const parseDur = t => { if(t==null||t==="") return null; const p = String(t).trim().split(/[:'"’”]+/).filter(Boolean).map(Number); if(p.some(isNaN)) return null; return p.length===3 ? p[0]*3600+p[1]*60+p[2] : p.length===2 ? p[0]*60+p[1] : p[0]*60; };
const num = v => { if(v===""||v==null) return null; const n = Number(v); return isFinite(n) ? n : null; };
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const r1 = n => Math.round(n*10)/10;
const r05 = n => Math.round(n*2)/2;

/* ---------- local store ---------- */
function loadDB(){
  try{ const d = JSON.parse(localStorage.getItem(STORE_KEY)); if(d && d.runs) return d; }catch(e){}
  return null;
}
let DB = loadDB();
let storageOK = true;
if(!DB){
  DB = {runs:{}, plans:{}, weeks:{}, createdAt: jstNowText()};
  // 初期の仮予定（11月：基礎期、週間距離は前週比+10%以内）
  const seed = [["2026-11-04",2.5,"会話できる速さで"],["2026-11-07",3,"週末はゆっくり長め"],["2026-11-11",2.5,"走る習慣づくり"],["2026-11-14",3.5,"週末はゆっくり長め"],
                ["2026-11-18",3,"走る習慣づくり"],["2026-11-21",3.6,"週末はゆっくり長め"],["2026-11-25",2.5,"回復週"],["2026-11-28",3,"回復週"]];
  if(logicalToday() < "2026-11-04") seed.forEach(([d,km,note])=>DB.plans[d]={date:d,type:"easy",distanceKm:km,durationMin:null,pace:"6:40-7:10",note,source:"auto",updatedAt:jstNowText()});
  persist();
}
function persist(){
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(DB)); storageOK = true; }catch(e){ storageOK = false; }
}
const setRun = (id,d) => { DB.runs[id] = d; persist(); };
const delRun = id => { delete DB.runs[id]; persist(); };
const setPlan = (k,d) => { DB.plans[k] = d; persist(); };
const delPlan = k => { delete DB.plans[k]; persist(); };
const setWeek = (k,d) => { DB.weeks[k] = d; persist(); };

/* ---------- state ---------- */
const S = { tab:"cal", sel:logicalToday(), view:null };
{ const t = fromKey(logicalToday()); S.view = {y:t.getUTCFullYear(), m:t.getUTCMonth()}; }

const runsOn = k => Object.entries(DB.runs).filter(([,r])=>r.date===k).sort((a,b)=>String(a[1].startAt).localeCompare(String(b[1].startAt)));
function weekStats(mon){
  const days = [...Array(7)].map((_,i)=>addDays(mon,i));
  const runs = days.flatMap(d=>runsOn(d).map(([id,r])=>({id,...r})));
  const plans = days.map(d=>DB.plans[d]).filter(Boolean);
  const km = runs.reduce((a,r)=>a+(r.distanceKm||0),0);
  const sec = runs.reduce((a,r)=>a+(r.durationSec||0),0);
  const planRunsArr = plans.filter(p=>p.type!=="rest");
  const planKm = planRunsArr.reduce((a,p)=>a+(p.distanceKm||0),0);
  const doneDays = planRunsArr.filter(p=>runsOn(p.date).length).length;
  const rpes = runs.map(r=>r.rpe).filter(Boolean), fats = runs.map(r=>r.fatigue).filter(Boolean);
  const hrs = runs.filter(r=>r.avgHr && r.durationSec && !hrSuspicious(r));
  const avgHr = hrs.length ? hrs.reduce((a,r)=>a+r.avgHr*r.durationSec,0)/hrs.reduce((a,r)=>a+r.durationSec,0) : null;
  const longest = runs.reduce((a,r)=>Math.max(a,r.distanceKm||0),0);
  return {days, runs, plans, km, sec, planKm, planRuns:planRunsArr.length, doneDays, longest,
    avgPace: km ? sec/km : null, avgHr, avgRpe: rpes.length ? rpes.reduce((a,b)=>a+b,0)/rpes.length : null,
    maxFatigue: fats.length ? Math.max(...fats) : null, pain: runs.some(hasPain)};
}
const hasPain = r => !!r.pain || /痛|違和感/.test(r.memo||"");
function hrSuspicious(r){
  if(!r.avgHr) return false;
  if(r.avgHr < 70 || r.avgHr > 215) return true;
  if(r.maxHr && r.avgHr > r.maxHr) return true;
  // 体感がかなり楽（RPE≦3）なのに心拍が推定最大の90%以上 → 手首心拍の誤作動の可能性
  if(r.rpe && r.rpe <= 3 && r.avgHr >= EST_MAX_HR*0.9) return true;
  return false;
}

/* ---------- rendering ---------- */
const $ = id => document.getElementById(id);
function render(){
  document.querySelectorAll(".tab").forEach(b=>b.setAttribute("aria-selected", b.dataset.tab===S.tab));
  $("dowRow").hidden = S.tab!=="cal";
  $("prev").hidden = $("next").hidden = $("todayBtn").hidden = S.tab!=="cal";
  const main = $("main");
  if(S.tab==="cal"){ $("monthLabel").innerHTML = `${S.view.m+1}月<small class="num">${S.view.y}</small>`; main.innerHTML = renderCal(); }
  else if(S.tab==="weeks"){ $("monthLabel").textContent = "週のまとめ"; main.innerHTML = renderWeeks(); }
  else { $("monthLabel").textContent = "ランの記録"; main.innerHTML = renderLog(); }
}
const storeNote = () => storageOK ? "" : `<div class="note bad" style="margin-top:12px">この端末に保存できませんでした。プライベートブラウズを切るか、空き容量を確認してください。</div>`;

function renderCal(){
  const {y,m} = S.view;
  const first = key(new Date(Date.UTC(y,m,1)));
  const last = key(new Date(Date.UTC(y,m+1,0)));
  let k = mondayOf(first);
  const end = addDays(mondayOf(last),6);
  const today = logicalToday();
  let cells = "";
  while(k <= end){
    const d = fromKey(k), wd = dow(k);
    const cls = ["cell", d.getUTCMonth()!==m?"out":"", wd===5?"sat":"", wd===6?"sun":"", HOLIDAYS.has(k)?"hol":"", k===today?"today":"", k===S.sel?"sel":""].join(" ");
    const p = DB.plans[k], runs = runsOn(k);
    let chips = "";
    if(p){ const t = TYPES[p.type]||TYPES.easy; chips += `<span class="chip plan ${t.cls} ${runs.length?"done":""}">${t.label}${p.distanceKm?" "+p.distanceKm:""}</span>`; }
    runs.forEach(([,r])=>{ chips += `<span class="chip run ${(r.fatigue>=4||hasPain(r))?"hi":""} num">✓${r.distanceKm!=null?r1(r.distanceKm):""}km</span>`; });
    cells += `<button class="cell ${cls}" data-day="${k}" aria-label="${mdw(k)}"><span class="d num">${d.getUTCDate()}</span>${chips}</button>`;
    k = addDays(k,1);
  }
  const legend = `<div class="legend">${Object.values(TYPES).map(t=>`<span><i class="${t.cls}"></i>${t.label}</span>`).join("")}<span><i style="box-shadow:inset 0 0 0 1.5px var(--c-run)"></i>実施</span></div>`;
  return `${storeNote()}<div class="cal">${cells}</div>${legend}${renderDay(S.sel)}${autoBanner()}`;
}

function autoBanner(){
  const prev = addDays(mondayOf(logicalToday()),-7);
  const w = DB.weeks[prev];
  if(w && w.proposalStatus==="pending" && (w.proposals||[]).length)
    return `<div class="section"><button class="banner" style="border:0;text-align:left" data-goto-weeks="1"><b>来週の予定の変更候補があります。</b><span class="muted">週のまとめで確認</span></button></div>`;
  return "";
}

function renderDay(k){
  const p = DB.plans[k], runs = runsOn(k);
  const st = weekStats(mondayOf(k));
  const pct = st.planKm ? Math.min(100, st.km/st.planKm*100) : (st.km?100:0);
  let planHtml;
  if(p){
    const t = TYPES[p.type]||TYPES.easy;
    const bits = [p.distanceKm?`${p.distanceKm} km`:"", p.durationMin?`${p.durationMin} 分`:"", p.pace?`${esc(p.pace)}/km`:""].filter(Boolean).join(" ・ ");
    planHtml = `<button class="card" style="border:0;text-align:left;width:100%" data-edit-plan="${k}">
      <div class="row between"><span class="tag ${t.cls}">${t.label}</span><span class="small muted">${p.source==="auto"?"自動提案から":"予定"}</span></div>
      ${bits?`<div class="num" style="font-weight:700">${bits}</div>`:""}
      ${p.note?`<div class="small muted">${esc(p.note)}</div>`:""}</button>`;
  } else {
    planHtml = `<button class="empty" data-edit-plan="${k}">予定はありません。タップして予定を入れる</button>`;
  }
  const runHtml = runs.length ? runs.map(([id,r])=>runCard(id,r)).join("") :
    `<button class="empty" data-new-run="${k}">この日の記録はありません。Mi Fitnessのスクショから記録する</button>`;
  return `<div class="section">
    <div class="sec-h"><h2>${mdw(k)}</h2><span class="sub num">この週 ${r1(st.km)} / ${r1(st.planKm)} km</span></div>
    <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
    ${planHtml}${runHtml}</div>`;
}

function runCard(id,r){
  const flags = [];
  if(r.rpe) flags.push(`<span class="pill ${r.rpe>=8?"bad":r.rpe>=6?"warn":"ok"}">強度 ${r.rpe}/10</span>`);
  if(r.fatigue) flags.push(`<span class="pill ${r.fatigue>=4?"bad":r.fatigue>=3?"warn":"ok"}">疲労 ${r.fatigue}/5</span>`);
  if(hasPain(r)) flags.push(`<span class="pill bad">痛み・違和感</span>`);
  if(!r.rpe || !r.fatigue) flags.push(`<span class="pill warn">体感を入力</span>`);
  const t = String(r.startAt||"").slice(11,16);
  return `<button class="runitem" data-run="${id}">
    <div class="dt"><b class="num">${r.distanceKm!=null?r1(r.distanceKm):"—"}</b><span class="small muted">km</span></div>
    <div class="mid"><div class="num" style="font-weight:700">${fmtDur(r.durationSec)} ・ ${fmtPace(r.paceSec)}/km${r.avgHr?` ・ ${r.avgHr} bpm`:""}</div>
    <div class="small muted num">${t?t+" スタート":""}</div>
    <div class="row" style="flex-wrap:wrap;gap:4px;margin-top:4px">${flags.join("")}</div></div></button>`;
}

function renderLog(){
  const list = Object.entries(DB.runs).sort((a,b)=>String(b[1].date+b[1].startAt).localeCompare(String(a[1].date+a[1].startAt)));
  const total = list.reduce((a,[,r])=>a+(r.distanceKm||0),0);
  const last28 = addDays(logicalToday(),-27);
  const km28 = list.filter(([,r])=>r.date>=last28).reduce((a,[,r])=>a+(r.distanceKm||0),0);
  const head = `<div class="section"><div class="stats">
    <div class="stat"><b class="num">${list.length}</b><span>回</span></div>
    <div class="stat"><b class="num">${r1(km28)}</b><span>直近4週 km</span></div>
    <div class="stat"><b class="num">${r1(total)}</b><span>累計 km</span></div></div></div>`;
  const prof = `<div class="section"><div class="card"><b>相談用プロフィール</b>
    <div class="small muted">AIに相談する文章の先頭に入ります。目標や走れる日数が変わったら書き換えてください。</div>
    <div class="field"><label for="profTxt">プロフィール</label><textarea id="profTxt" rows="7">${esc(getProfile())}</textarea></div>
    <button class="btn ghost" id="profSave">保存</button></div></div>`;
  const backup = prof + `<div class="section"><div class="card"><b>バックアップ</b>
    <div class="small muted">データはこのスマホの中だけに保存されています。機種変更やブラウザのデータ削除に備えて、ときどき書き出してください。</div>
    <div class="btns"><button class="btn ghost" id="exportBtn">データを書き出す</button><label class="btn ghost" for="importFile" style="text-align:center">読み込む<input type="file" id="importFile" accept="application/json,.json" hidden></label></div></div></div>`;
  let out = "";
  if(!list.length) out = `<div class="empty">まだ記録がありません。右下の＋からMi Fitnessのスクリーンショットを選ぶと、距離・ペース・心拍などを読み取って記録します。</div>`;
  let lastMonth = "";
  list.forEach(([id,r])=>{
    const mo = r.date.slice(0,7);
    if(mo!==lastMonth){ out += `<div class="sec-h" style="margin-top:6px"><h2>${+mo.slice(5)}月</h2></div>`; lastMonth = mo; }
    out += `<div class="small muted">${mdw(r.date)}</div>` + runCard(id,r);
  });
  return storeNote()+head+`<div class="section">${out}</div>`+backup;
}

function renderWeeks(){
  const cur = mondayOf(logicalToday());
  const mons = new Set([cur]);
  Object.values(DB.runs).forEach(r=>mons.add(mondayOf(r.date)));
  Object.keys(DB.weeks).forEach(k=>mons.add(k));
  const list = [...mons].filter(k=>k<=cur).sort().reverse();
  const planCard = `<div class="card"><div><b>これから4週間の予定</b><div class="small muted">記録とルール（週+10%以内など）から、来週月曜からの予定案を作ります</div></div>
    <button class="btn ghost" data-plan4="1">予定案を作る</button></div>`;
  return storeNote()+`<div class="section">${planCard}${list.map(weekCard).join("")}</div>
    <p class="small muted" style="margin-top:14px">月曜の朝5時を過ぎてからアプリを開くと、前の週（月〜日）のまとめと来週の予定の変更候補が自動で作られます。朝5時までのランは前日の記録として扱います。</p>`;
}

function weekCard(mon){
  const st = weekStats(mon), w = DB.weeks[mon];
  const isCur = mon===mondayOf(logicalToday());
  const head = `<div class="row between"><b class="num">${md(mon)} 〜 ${md(addDays(mon,6))}</b>${isCur?`<span class="pill">今週</span>`:""}</div>
    <div class="stats">
      <div class="stat"><b class="num">${r1(st.km)}<small style="font-size:11px"> km</small></b><span>予定 ${r1(st.planKm)} km</span></div>
      <div class="stat"><b class="num">${st.runs.length}<small style="font-size:11px"> 回</small></b><span>予定日の実施 ${st.doneDays}/${st.planRuns}</span></div>
      <div class="stat"><b class="num">${fmtPace(st.avgPace)}</b><span>平均ペース/km</span></div>
      <div class="stat"><b class="num">${st.avgHr?Math.round(st.avgHr):"—"}</b><span>平均心拍</span></div>
      <div class="stat"><b class="num">${st.avgRpe?r1(st.avgRpe):"—"}</b><span>体感強度 平均</span></div>
      <div class="stat"><b class="num">${st.maxFatigue??"—"}</b><span>疲労度 最大</span></div>
    </div>`;
  let body = "";
  if(w){
    body = `${w.declaration?`<div class="decl">${esc(w.declaration)}</div>`:""}
      ${w.headline?`<div style="font-weight:700">${esc(w.headline)}</div>`:""}
      ${w.painAlert?`<div class="note bad">痛みや違和感の記録があります。走るのを止めて、続くようなら医療機関に相談してください。</div>`:""}
      ${(w.dataNotes||[]).length?`<div><div class="flabel">データの扱い</div><ul class="clean small">${w.dataNotes.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`:""}
      ${(w.good||[]).length?`<div><div class="flabel">良かった点</div><ul class="clean">${w.good.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`:""}
      ${(w.change||[]).length?`<div><div class="flabel">次に変える点</div><ul class="clean">${w.change.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`:""}
      ${proposalsHtml(mon,w)}
      <div class="small muted">${w.generatedAt?`作成 ${esc(w.generatedAt)}`:""}${w.generatedBy==="auto"?"（自動）":""}</div>`;
  }
  const canGen = st.runs.length || st.plans.length;
  const genBtn = canGen ? `<button class="btn ${w?"ghost":"primary"}" data-gen="${mon}">${w?"作り直す":isCur?"途中までの内容でまとめる":"まとめを作る"}</button>` : "";
  const askBtn = canGen ? `<div class="btns"><button class="btn ghost" data-ask="${mon}">AIに相談する文章を作る</button><button class="btn ghost" data-paste="${mon}">AIの回答を予定に反映</button></div>` : "";
  return `<div class="card">${head}${body}${genBtn}${askBtn}</div>`;
}

function proposalsHtml(mon,w){
  const props = w.proposals||[];
  const next = addDays(mon,7);
  if(!props.length) return `<div class="note ok">来週（${md(next)}〜）の予定は変更なしで大丈夫です。${w.proposalReason?esc(w.proposalReason):""}</div>`;
  const rows = props.map(p=>{
    const t = TYPES[p.type]||TYPES.easy;
    const cur = DB.plans[p.date];
    const curTxt = cur ? `${(TYPES[cur.type]||TYPES.easy).label}${cur.distanceKm?" "+cur.distanceKm+"km":""}` : "なし";
    const newTxt = p.action==="delete" ? "予定を外す" : `${t.label}${p.distanceKm?" "+p.distanceKm+"km":""}${p.durationMin?" "+p.durationMin+"分":""}${p.pace?" "+esc(p.pace)+"/km":""}`;
    return `<div class="prop"><b class="num">${mdw(p.date)}</b><div><div class="small muted">現在：${curTxt}</div><div><b>→ ${newTxt}</b></div>${p.note?`<div class="small muted">${esc(p.note)}</div>`:""}</div></div>`;
  }).join("");
  const status = w.proposalStatus;
  const actions = status==="applied" ? `<span class="pill ok">予定に反映済み</span>` : status==="dismissed" ? `<span class="pill">見送り</span>` :
    `<div class="btns"><button class="btn primary" data-apply="${mon}">この内容で予定を変更</button><button class="btn ghost" data-dismiss="${mon}">見送る</button></div>`;
  return `<div><div class="flabel">来週の予定の変更候補</div>${w.proposalReason?`<div class="small" style="margin:4px 0">${esc(w.proposalReason)}</div>`:""}<div>${rows}</div></div>${actions}`;
}

/* ---------- sheet ---------- */
function openSheet(html, onMount){
  const root = $("sheetRoot");
  root.innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  $("scrim").addEventListener("click", e=>{ if(e.target.id==="scrim") closeSheet(); });
  onMount && onMount(root.querySelector(".sheet"));
}
const closeSheet = () => { $("sheetRoot").innerHTML = ""; };
function toast(msg){ const t = document.createElement("div"); t.className="toast"; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2200); }

function openPlan(k){
  const p = DB.plans[k] || {type:"easy"};
  let type = p.type;
  openSheet(`<h3>${mdw(k)}の予定</h3>
    <div class="types">${Object.entries(TYPES).map(([id,t])=>`<button class="${t.cls}" data-type="${id}" aria-pressed="${id===type}">${t.label}</button>`).join("")}</div>
    <div class="grid2"><div class="field"><label for="pDist">距離 km</label><input id="pDist" inputmode="decimal" value="${p.distanceKm??""}"></div>
    <div class="field"><label for="pMin">時間 分</label><input id="pMin" inputmode="numeric" value="${p.durationMin??""}"></div></div>
    <div class="field"><label for="pPace">設定ペース（例 6:40-7:10）</label><input id="pPace" value="${esc(p.pace||"")}"></div>
    <div class="field"><label for="pNote">メモ</label><input id="pNote" value="${esc(p.note||"")}"></div>
    <div class="btns"><button class="btn primary" id="pSave">保存</button>${DB.plans[k]?`<button class="btn danger" id="pDel">予定を消す</button>`:""}</div>`, sh=>{
    sh.querySelectorAll("[data-type]").forEach(b=>b.onclick=()=>{ type=b.dataset.type; sh.querySelectorAll("[data-type]").forEach(x=>x.setAttribute("aria-pressed",x===b)); });
    $("pSave").onclick = ()=>{
      setPlan(k,{date:k,type,distanceKm:num($("pDist").value),durationMin:num($("pMin").value),pace:$("pPace").value.trim(),note:$("pNote").value.trim(),source:"manual",updatedAt:jstNowText()});
      closeSheet(); render(); toast("予定を保存しました");
    };
    const del = $("pDel");
    if(del) del.onclick = ()=>{
      if(del.dataset.armed){ delPlan(k); closeSheet(); render(); toast("予定を消しました"); }
      else { del.dataset.armed="1"; del.textContent="もう一度押すと消えます"; }
    };
  });
}

function openRun(id){
  const r = DB.runs[id]; if(!r) return;
  const splits = r.splits||[];
  const maxS = Math.max(...splits,1), minS = Math.min(...splits,maxS);
  const zones = r.hrZones||{};
  const zlist = [["warmup","ウォームアップ"],["intensive","インテンシブ"],["aerobic","有酸素"],["anaerobic","無酸素"],["vo2max","最大酸素摂取量"]];
  const zTot = zlist.reduce((a,[z])=>a+(zones[z]||0),0);
  openSheet(`<div class="row between"><h3>${mdw(r.date)}のラン</h3><span class="small muted num">${esc(String(r.startAt||"").slice(11,16))} スタート</span></div>
    <div class="kv">
      <div class="stat"><b class="num">${r.distanceKm??"—"}</b><span>km</span></div>
      <div class="stat"><b class="num">${fmtDur(r.durationSec)}</b><span>時間</span></div>
      <div class="stat"><b class="num">${fmtPace(r.paceSec)}</b><span>ペース/km</span></div>
      <div class="stat"><b class="num">${r.avgHr??"—"}<small style="font-size:11px">/${r.maxHr??"—"}</small></b><span>心拍 平均/最大</span></div>
      <div class="stat"><b class="num">${r.cadence??"—"}</b><span>ケイデンス</span></div>
      <div class="stat"><b class="num">${r.strideCm??"—"}</b><span>ストライド cm</span></div>
    </div>
    ${splits.length?`<div class="card"><div class="flabel">km毎のペース</div><div class="splits">${splits.map((s,i)=>`<div class="split num"><span>${i+1}</span><div class="bar"><i style="width:${30+70*(maxS-s)/Math.max(1,maxS-minS)}%"></i></div><span>${fmtPace(s)}</span></div>`).join("")}</div></div>`:""}
    ${zTot?`<div class="card"><div class="flabel">心拍ゾーン（Mi Fitness判定）</div><div class="splits">${zlist.filter(([z])=>zones[z]).map(([z,l])=>`<div class="split num" style="grid-template-columns:96px minmax(0,1fr) 48px"><span>${l}</span><div class="bar"><i style="width:${zones[z]/zTot*100}%;background:var(--c-threshold)"></i></div><span>${fmtDur(zones[z])}</span></div>`).join("")}</div><div class="small muted">手首の光学式心拍のため、明らかに外れた値はまとめで除外します。</div></div>`:""}
    <div class="small muted num">${[r.vo2max?`VO2max ${r.vo2max}`:"", r.trainingLoad?`トレーニング負荷 ${r.trainingLoad}`:"", r.trainingEffect?`効果の評価 ${r.trainingEffect}`:"", r.recoveryHours?`回復 ${r.recoveryHours}時間`:"", r.vitality!=null?`活力スコア ${r.vitality>0?"+":""}${r.vitality}`:"", r.calories?`${r.calories} kcal`:"", r.steps?`${r.steps}歩`:""].filter(Boolean).join(" ・ ")}</div>
    ${feelFields(r)}
    <div class="field"><label for="fMemo">メモ</label><textarea id="fMemo" rows="2">${esc(r.memo||"")}</textarea></div>
    <div class="btns"><button class="btn primary" id="rSave">保存</button><button class="btn ghost" id="rEdit">数値を直す</button><button class="btn danger" id="rDel">削除</button></div>`, sh=>{
    const feel = bindFeel(sh, r);
    $("rSave").onclick = ()=>{ setRun(id,{...r, rpe:feel.rpe, fatigue:feel.fatigue, pain:$("fPain").checked, memo:$("fMemo").value.trim()}); closeSheet(); render(); toast("保存しました"); };
    $("rEdit").onclick = ()=>openRunForm({...r}, id);
    const del = $("rDel");
    del.onclick = ()=>{ if(del.dataset.armed){ delRun(id); closeSheet(); render(); toast("記録を削除しました"); } else { del.dataset.armed="1"; del.textContent="もう一度押すと削除"; } };
  });
}

function feelFields(r){
  return `<div class="card"><div class="flabel">体感強度（10段階）</div>
    <div class="scale" id="rpe">${[...Array(10)].map((_,i)=>`<button data-v="${i+1}" aria-pressed="${r.rpe===i+1}" class="num">${i+1}</button>`).join("")}</div>
    <div class="scale-cap"><span>1 とても楽</span><span id="rpeCap">${r.rpe?RPE_CAP[r.rpe-1]:""}</span><span>10 限界</span></div>
    <div class="flabel" style="margin-top:6px">疲労度（5段階）</div>
    <div class="scale five" id="fat">${[...Array(5)].map((_,i)=>`<button data-v="${i+1}" aria-pressed="${r.fatigue===i+1}" class="num">${i+1}</button>`).join("")}</div>
    <div class="scale-cap"><span>1 元気</span><span id="fatCap">${r.fatigue?FATIGUE_CAP[r.fatigue-1]:""}</span><span>5 限界</span></div>
    <label class="toggle" for="fPain"><input type="checkbox" id="fPain" ${r.pain?"checked":""}>痛み・違和感がある</label></div>`;
}
function bindFeel(sh, r){
  const st = {rpe:r.rpe||null, fatigue:r.fatigue||null};
  sh.querySelectorAll("#rpe button").forEach(b=>b.onclick=()=>{ st.rpe=+b.dataset.v; sh.querySelectorAll("#rpe button").forEach(x=>x.setAttribute("aria-pressed",x===b)); $("rpeCap").textContent=RPE_CAP[st.rpe-1]; });
  sh.querySelectorAll("#fat button").forEach(b=>b.onclick=()=>{ st.fatigue=+b.dataset.v; sh.querySelectorAll("#fat button").forEach(x=>x.setAttribute("aria-pressed",x===b)); $("fatCap").textContent=FATIGUE_CAP[st.fatigue-1]; });
  return st;
}

/* ---------- screenshot reading (on-device OCR) ---------- */
let tessLoad = null;
function loadTesseract(){
  if(window.Tesseract) return Promise.resolve();
  if(!tessLoad) tessLoad = new Promise((res,rej)=>{ const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"; s.onload = res; s.onerror = ()=>{ tessLoad = null; rej(new Error("load")); }; document.head.appendChild(s); });
  return tessLoad;
}
async function prepImage(file){
  const bmp = await createImageBitmap(file);
  const scale = bmp.width < 1000 ? 1100/bmp.width : (bmp.width > 1400 ? 1300/bmp.width : 1);
  const W = Math.round(bmp.width*scale), H = Math.round(bmp.height*scale);
  // 縦に長い画像はカードの間の余白で区切って分割する（iPhoneのキャンバス上限と読み取り精度のため）
  const probe = document.createElement("canvas"); probe.width = W; probe.height = 1;
  const pg = probe.getContext("2d", {willReadFrequently:true});
  const rowBlank = y => { if(y<=0||y>=H) return false; pg.clearRect(0,0,W,1); pg.drawImage(bmp, 0, y/scale, bmp.width, Math.max(1,1/scale), 0, 0, W, 1); const d = pg.getImageData(0,0,W,1).data; let mn=255, mx=0; for(let x=0;x<d.length;x+=16){ const v=(d[x]+d[x+1]+d[x+2])/3; if(v<mn)mn=v; if(v>mx)mx=v; } return mx-mn < 14; };
  const piece = 2400, cuts = [0];
  while(H - cuts[cuts.length-1] > piece*1.3){
    const target = cuts[cuts.length-1] + piece; let cut = target;
    for(let o=0;o<600;o+=3){ if(rowBlank(target+o)){ cut = target+o; break; } if(rowBlank(target-o)){ cut = target-o; break; } }
    cuts.push(cut);
  }
  cuts.push(H);
  const pieces = [], bars = [];
  for(let i=0;i<cuts.length-1;i++){
    const c = document.createElement("canvas"); c.width = W; c.height = cuts[i+1]-cuts[i];
    const g = c.getContext("2d", {willReadFrequently:true}); g.fillStyle = "#fff"; g.fillRect(0,0,W,c.height);
    g.drawImage(bmp, 0, cuts[i]/scale, bmp.width, c.height/scale, 0, 0, W, c.height);
    const img = g.getImageData(0,0,W,c.height), d = img.data, Hc = c.height;
    // 行ごとに、色の付いた横長の帯（km毎ペースの緑のバー）があるかを調べる
    const info = new Array(Hc);
    for(let y=0;y<Hc;y++){
      const row = y*W*4; let b0=-1, b1=-1, run0=-1, last=-99, sum=0, n=0;
      for(let x=0;x<W;x++){
        const k=row+x*4, mx=Math.max(d[k],d[k+1],d[k+2]), mn=Math.min(d[k],d[k+1],d[k+2]);
        if(mx-mn>60){ if(run0<0 || x-last>40) run0=x; last=x; if(last-run0 > b1-b0){ b0=run0; b1=last; } sum += d[k]*0.299+d[k+1]*0.587+d[k+2]*0.114; n++; }
      }
      info[y] = (b1-b0 > W*0.3) ? {b0, b1, th:(sum/n+255)/2} : null;
    }
    // 連続した帯の行をまとめ、バーらしい高さのものだけ切り出す（グラフの塗りつぶしのような背の高いものは除く）
    for(let y=0;y<Hc;){
      if(!info[y]){ y++; continue; }
      let y2 = y; while(y2+1<Hc && info[y2+1]) y2++;
      const h = y2-y+1;
      if(h >= W*0.022 && h <= W*0.08){
        const x0 = Math.min(...info.slice(y,y2+1).map(o=>o.b0)), th = info[Math.floor((y+y2)/2)].th;
        const cw = Math.round(W*0.32), S = 3;
        const bc = document.createElement("canvas"); bc.width = cw*S; bc.height = h*S + 40;
        const bg = bc.getContext("2d"); bg.fillStyle="#fff"; bg.fillRect(0,0,bc.width,bc.height);
        const bi = bg.createImageData(cw, h), bd = bi.data;
        for(let yy=0; yy<h; yy++) for(let xx=0; xx<cw; xx++){
          const sk = ((y+yy)*W + Math.min(W-1, x0+xx))*4, tk = (yy*cw+xx)*4;
          const lum = d[sk]*0.299+d[sk+1]*0.587+d[sk+2]*0.114;
          const v = lum > th ? 0 : 255; bd[tk]=bd[tk+1]=bd[tk+2]=v; bd[tk+3]=255;
        }
        const tmp = document.createElement("canvas"); tmp.width=cw; tmp.height=h; tmp.getContext("2d").putImageData(bi,0,0);
        bg.imageSmoothingEnabled = true; bg.drawImage(tmp, 0, 20, cw*S, h*S);
        bars.push(bc);
      }
      y = y2+1;
    }
    // 本文はふつうの白黒で読む
    for(let k=0;k<d.length;k+=4){ const v = d[k]*0.299+d[k+1]*0.587+d[k+2]*0.114; d[k]=d[k+1]=d[k+2]=v; }
    g.putImageData(img,0,0);
    pieces.push(c);
  }
  return {pieces, bars};
}
let lastOcrText = "";
// バーの文字（例 5'28"）を秒に。「'」が「1」や「7」と読まれることがあるので補正する
function barPace(t){
  const ok = (m,x) => (+x<60 && m*60 + +x >= 150 && m*60 + +x <= 900) ? m*60 + +x : null;
  const e = t.match(/(\d{1,2})['’:](\d{2})/); if(e){ const v = ok(+e[1], e[2]); if(v) return v; }
  const d = (t.match(/\d+/g)||[]).join("").slice(0,5);
  if(d.length===3) return ok(+d[0], d.slice(1,3));
  if(d.length===4) return (/[17]/.test(d[1]) && ok(+d[0], d.slice(2,4))) || ok(+d.slice(0,2), d.slice(2,4));
  if(d.length===5) return ok(+d.slice(0,2), d.slice(3,5)) || ok(+d[0], d.slice(2,4));
  return null;
}
async function ocrScreenshot(file, onProgress){
  await loadTesseract();
  let done = 0, parts = 1;
  const worker = await Tesseract.createWorker(["jpn","eng"], 1, {logger: m => { if(m.status==="recognizing text") onProgress(Math.round((done + m.progress)/parts*100)); }});
  try{
    const {pieces, bars} = await prepImage(file); parts = pieces.length + (bars.length ? 1 : 0);
    let text = "";
    for(const c of pieces){ const { data } = await worker.recognize(c); text += data.text + "\n"; done++; }
    const out = parseMiFitness(text);
    // km毎ペース：バーの中の文字を1本ずつ読む
    let barText = "";
    if(bars.length){
      await worker.setParameters({tessedit_pageseg_mode: "7"});
      const sp = [];
      for(const bc of bars){
        const { data } = await worker.recognize(bc); const t = normalizeOcr(data.text).replace(/\s+/g,"");
        barText += t + "\n";
        const v = barPace(t); if(v) sp.push(v);
      }
      if(sp.length && (!out.distanceKm || sp.length <= Math.ceil(out.distanceKm)+1)) out.splits = sp;
    }
    lastOcrText = text + (barText ? "\n--- km毎のバー ---\n" + barText : "");
    return out;
  } finally { worker.terminate(); }
}
function normalizeOcr(t){
  const circ="⓪①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
  t=t.replace(/[⓪①-⑳]/g,c=>String(circ.indexOf(c)));
  t=t.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0));
  t=t.replace(/[：]/g,":").replace(/[．。・]/g,".").replace(/[’′‘`´°]/g,"'").replace(/[”″“]/g,'"');
  // digits split by single spaces inside numbers like "1 6 4" are rare; join digit-space-digit only when both sides are single digits
  return t;
}
function parseMiFitness(raw){
  const lines=normalizeOcr(raw).split(/\n/).map(l=>l.trim()).filter(Boolean);
  const C=lines.map(l=>l.replace(/\s+/g,""));
  const out={};
  const ints=l=>(l.match(/\d+/g)||[]).map(Number);
  const T=/(\d{1,2})\s*[:.]\s*(\d{2})\s*[:.]\s*(\d{2})/;
  const P=/(\d{1,2})\s*'\s*(\d{2})\s*"?/;
  const sec=m=>+m[1]*3600+ +m[2]*60+ +m[3];
  // date & start
  for(const l of [...lines, ...C]){ const m = l.match(/(20[2-3]\d)\s*[\/.\-年1l|]\s*(1[0-2]|0?[1-9])\s*[\/.\-月1l|]\s*(3[01]|[12]\d|0?[1-9])\s*日?\s*([01]?\d|2[0-3])\s*[:;.]\s*([0-5]\d)/); if(m){ out.startAt=`${m[1]}-${pad(m[2])}-${pad(m[3])} ${pad(m[4])}:${m[5]}`; break; } }
  // workout time = first h:mm:ss
  let di=lines.findIndex(l=>T.test(l));
  if(di>=0){
    const m=lines[di].match(T); out.durationSec=sec(m);
    const after=ints(lines[di].slice(lines[di].indexOf(m[0])+m[0].length)).filter(n=>n>=20&&n<=3000);
    if(after.length) out.calories=after[0];
    // distance: look upward for d.dd (or ddd followed by km)
    for(let i=di;i>=0&&i>=di-10;i--){
      let src=i===di?lines[i].slice(0,lines[i].indexOf(m[0])):lines[i];
      if(/20\d\d[\/.\-]/.test(src)) src=src.replace(/20\d\d[\/.\-]\d{1,2}[\/.\-]\d{1,2}\d{0,2}:?\d{0,2}/,"");
      let d=src.match(/(?<![\d.])(\d{1,2})[.,](\d{1,2})(?![\d:])/);
      if(!d){const k=src.match(/(?<!\d)(\d)(\d{2})k?m/i); if(k) d=[k[0],k[1],k[2]];}
      if(d){const v=+(d[1]+"."+d[2].padEnd(2,"0")); if(v>0.2&&v<60){out.distanceKm=v;break;}}
    }
  } else di=0;
  // after workout time: sequential structure
  let i=di+1;
  const find=(from,fn,limit=40)=>{for(let k=from;k<Math.min(lines.length,from+limit);k++){const r=fn(lines[k],C[k],k); if(r) return {k,r};} return null;};
  const pace=find(i,(l)=>{const m=l.match(P); if(!m) return null; const rest=ints(l.slice(l.indexOf(m[0])+m[0].length)); return {pace:+m[1]*60+ +m[2],hr:rest.find(n=>n>=60&&n<=230),steps:rest.find(n=>n>=300)};},8);
  if(pace){out.paceSec=pace.r.pace; if(pace.r.hr) out.avgHr=pace.r.hr; if(pace.r.steps) out.steps=pace.r.steps; i=pace.k+1;}
  // heart card: first line after pace with 2 ints in HR range and nothing like time/pace
  const hr=find(i,(l)=>{ if(T.test(l)||P.test(l)) return null; const n=ints(l).filter(x=>x>=60&&x<=230); return n.length>=2&&ints(l).length<=3? n:null;},12);
  if(hr){ out.avgHr=out.avgHr||hr.r[0]; out.maxHr=hr.r[1]; i=hr.k+1; }
  // zones: next 5 time strings
  const zt=[];let k=i;
  for(;k<lines.length&&zt.length<5;k++){ if(P.test(lines[k])&&zt.length) break; const m=lines[k].match(/(\d{2})\s*[:.\s]\s*(\d{2})\s*[:.\s]\s*(\d{2})/); if(m) zt.push(+m[2]<60&&+m[3]<60 ? sec(m) : null); }
  if(zt.length===5){ const [warmup,intensive,aerobic,anaerobic,vo2max]=zt; out.hrZones={warmup,intensive,aerobic,anaerobic,vo2max}; i=k; }
  // pace card (avg / best) then splits
  const pc=find(i,l=>(l.match(/\d{1,2}\s*'\s*\d{2}/g)||[]).length>=2?1:null,10); if(pc) i=pc.k+1;
  const sp=[];
  for(k=i;k<Math.min(lines.length,i+25);k++){
    if(/ケイデンス|時間|km\|/.test(C[k])&&sp.length) break;
    const c = C[k].replace(/"/g,"");
    const m = c.match(/(\d{1,3})'(\d{2})/); if(!m) continue;
    const idx = sp.length+1, pre = c.slice(0, m.index), pd = (pre.match(/\d+/g)||[]).pop();
    let mins = +m[1];
    if(pd!=null && +pd===idx){}                                            // 「1 5'28」
    else if(m[1].length>=2 && m[1].startsWith(String(idx))) mins = +m[1].slice(String(idx).length); // 「15'28」
    else if(pd!=null && +pd!==idx) continue;
    const v = mins*60 + +m[2];
    if(v>=150 && v<=900){ sp.push(v); i=k+1; }
  }
  if(sp.length) out.splits=sp;
  // cadence: first line with 2 ints in 100-260
  const cad=find(i,(l)=>{ if(T.test(l)) return null; const n=ints(l); const c=n.filter(x=>x>=100&&x<=260); return c.length>=2&&n.length<=3&&c[0]<=c[1]?c:null;},200);
  if(cad){ out.cadence=cad.r[0]; out.maxCadence=cad.r[1]; i=cad.k+1; }
  // stride: next line with 2 ints 30-250 (avg<max)
  const st=find(i,(l)=>{ if(T.test(l)) return null; const n=ints(l); const c=n.filter(x=>x>=30&&x<=250); return c.length>=2&&n.length<=3&&c[0]<=c[1]?c:null;},60);
  if(st){ out.strideCm=st.r[0]; i=st.k+1; }
  // training effect: a lone d.d
  const te=find(i,(l,c)=>{const m=c.match(/^[^\d]{0,3}([0-5])\.(\d)[^\d]{0,3}$/); return m?+(m[1]+"."+m[2]):null;},80);
  if(te){ out.trainingEffect=te.r; i=te.k+1;
    const lab = find(te.k,(l,c)=>{ const m=c.match(/大幅に向上|大きく向上|向上|維持|回復|過負荷|効果なし|最小限/); return m?m[0]:null; },3);
    if(lab) out.trainingEffectLabel = lab.r; }
  // vo2max + load: line with ml or two ints where first 20-90
  const vo=find(i,(l)=>{ const m=l.match(/(\d{2})\s*m[il1]/i); const n=ints(l); if(m){const load=n.filter(x=>x!==+m[1]&&x<=1000).pop(); return {v:+m[1],load};} return null;},200);
  if(vo){ out.vo2max=vo.r.v; if(vo.r.load!=null) out.trainingLoad=vo.r.load; i=vo.k+1; }
  const rec=find(i,(l)=>{const m=l.match(/^\D{0,2}(\d{1,3})\s*\S*\s*\+\s*(\d+)/)||l.match(/(\d{1,3})\s*時間/); return m&&+m[1]<=200?+m[1]:null;},30);
  if(rec){ out.recoveryHours=rec.r; const v = lines[rec.k].match(/([+\-])\s*(\d{1,3})(?!\d)/); if(v) out.vitality = (v[1]==="-"?-1:1)*+v[2]; }
  // fallbacks
  if(out.distanceKm==null&&out.durationSec&&out.paceSec) out.distanceKm=Math.round(out.durationSec/out.paceSec*100)/100;
  if(out.paceSec==null&&out.distanceKm&&out.durationSec) out.paceSec=Math.round(out.durationSec/out.distanceKm);
  if(out.splits&&out.distanceKm&&out.splits.length>Math.ceil(out.distanceKm)+1) delete out.splits;
  return out;
}

function openNewRun(defDate){
  openSheet(`<h3>ランを記録</h3>
    <label class="drop" for="img"><input type="file" id="img" accept="image/*">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>
      <b>Mi Fitnessのスクリーンショットを選ぶ</b>
      <span class="small muted">ワークアウト詳細の画面をそのまま。読み取りはスマホの中で行います</span></label>
    <div id="readArea"></div>
    <button class="btn ghost" id="manual">手入力で記録する</button>`, sh=>{
    $("manual").onclick = ()=>openRunForm({date:defDate||logicalToday()});
    $("img").onchange = async e=>{
      const f = e.target.files[0]; if(!f) return;
      const url = URL.createObjectURL(f);
      $("readArea").innerHTML = `<img class="thumb" src="${url}" alt="選んだ画像"><div class="banner"><span class="spin"></span><span id="rsTxt">読み取りの準備をしています（初回は文字データの読み込みで少し時間がかかります）</span></div>`;
      let ex = {}, failed = false;
      try{ ex = await ocrScreenshot(f, p=>{ const t = $("rsTxt"); if(t && p>=0) t.textContent = `文字を読み取っています ${p}%`; }); }
      catch(err){ failed = true; }
      const found = Object.keys(ex).length;
      openRunForm({...ex, date: logicalDateOf(ex.startAt) || defDate || logicalToday(), _read: failed ? "fail" : found ? "ok" : "none"});
    };
  });
}

function openRunForm(r, existingId){
  const readNote = r._read==="ok" ? `<div class="note ok small">読み取った値を入れました。スクショと見比べて、違うところは直してください。${r.startAt?`朝5時までのランは前日扱いのため、記録する日は「${mdw(r.date)}」にしています。`:"日付と時刻は読み取れなかったので入れてください。"}</div>`
    : r._read==="none" ? `<div class="note small">数値を読み取れませんでした。手で入れてください。</div>`
    : r._read==="fail" ? `<div class="note small">読み取りに失敗しました（初回は通信が必要です）。手で入れてください。</div>` : "";
  openSheet(`<h3>${existingId?"記録を直す":"内容を確認して保存"}</h3>${readNote}
    <div class="grid2">
      <div class="field"><label for="fDate">記録する日</label><input type="date" id="fDate" value="${esc(r.date||"")}"></div>
      <div class="field"><label for="fStart">開始時刻</label><input type="time" id="fStart" value="${esc(String(r.startAt||"").slice(11,16))}"></div>
      <div class="field"><label for="fDist">距離 km</label><input id="fDist" inputmode="decimal" value="${r.distanceKm??""}"></div>
      <div class="field"><label for="fDur">時間（例 28:10）</label><input id="fDur" value="${r.durationSec?fmtDur(r.durationSec):""}"></div>
      <div class="field"><label for="fHr">平均心拍</label><input id="fHr" inputmode="numeric" value="${r.avgHr??""}"></div>
      <div class="field"><label for="fMax">最大心拍</label><input id="fMax" inputmode="numeric" value="${r.maxHr??""}"></div>
      <div class="field"><label for="fCad">ケイデンス</label><input id="fCad" inputmode="numeric" value="${r.cadence??""}"></div>
      <div class="field"><label for="fStr">ストライド cm</label><input id="fStr" inputmode="numeric" value="${r.strideCm??""}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label for="fPace">平均ペース /km（例 5:36）</label><input id="fPace" value="${r.paceSec?paceTxt(r.paceSec):""}"></div>
      <div class="field"><label for="fCal">活動 kcal</label><input id="fCal" inputmode="numeric" value="${r.calories??""}"></div>
    </div>
    <div class="field"><label for="fSplits">km毎のペース（例 5:28 5:40 5:51）</label><input id="fSplits" value="${esc((r.splits||[]).map(paceTxt).join(" "))}"></div>
    <div class="card"><div class="flabel">効果・回復</div>
      <div class="grid2">
        <div class="field"><label for="fTE">効果の評価（例 3.6）</label><input id="fTE" inputmode="decimal" value="${r.trainingEffect??""}"></div>
        <div class="field"></div>
        <div class="field"><label for="fVO2">最大酸素摂取量 ml/kg/min</label><input id="fVO2" inputmode="decimal" value="${r.vo2max??""}"></div>
        <div class="field"><label for="fLoad">トレーニング負荷</label><input id="fLoad" inputmode="numeric" value="${r.trainingLoad??""}"></div>
        <div class="field"><label for="fRec">回復 時間</label><input id="fRec" inputmode="numeric" value="${r.recoveryHours??""}"></div>
        <div class="field"><label for="fVit">活力スコア（例 +28）</label><input id="fVit" inputmode="numeric" value="${r.vitality!=null?(r.vitality>0?"+":"")+r.vitality:""}"></div>
      </div></div>
    ${feelFields(r)}
    <div class="field"><label for="fMemo">メモ（天気・体調など）</label><textarea id="fMemo" rows="2">${esc(r.memo||"")}</textarea></div>
    <div class="note small" id="fErr" hidden></div>
    <button class="btn primary" id="fSave">保存</button>
    <div class="small muted" style="text-align:center">アプリのバージョン ${APP_VERSION}</div>
    ${r._read && lastOcrText ? `<details class="card"><summary class="small" style="cursor:pointer;font-weight:700">読み取った文字を見る（うまく読めないときの確認用・v${APP_VERSION}）</summary>
      <div class="small muted">読み取りがうまくいかないときは、この文字をコピーして改善の相談に使えます。</div>
      <button class="btn ghost" id="rawCopy" type="button">文字をコピー</button>
      <textarea id="rawTxt" rows="8" readonly style="width:100%;font-size:12px">${esc(lastOcrText)}</textarea></details>` : ""}`, sh=>{
    const feel = bindFeel(sh, r);
    const rc = $("rawCopy"); if(rc) rc.onclick = async()=>{ try{ await navigator.clipboard.writeText(lastOcrText); toast("コピーしました"); }catch(e){ const t=$("rawTxt"); t.focus(); t.select(); } };
    const relog = ()=>{ const t = $("fStart").value; const base = String(r.startAt||"").slice(0,10); if(t && base){ const k = logicalDateOf(`${base} ${t}`); if(k) $("fDate").value = k; } };
    $("fStart").onchange = relog;
    $("fSave").onclick = ()=>{
      const date = $("fDate").value;
      if(!date){ $("fErr").hidden=false; $("fErr").textContent="記録する日を入れてください。"; return; }
      const dist = num($("fDist").value), dur = parseDur($("fDur").value);
      const t = $("fStart").value;
      const startDay = String(r.startAt||"").slice(0,10) || date;
      const splits = $("fSplits").value.split(/[\s,、]+/).map(parseDur).filter(n=>n && n>120 && n<1200);
      const data = {
        date, startAt: t ? `${startDay} ${t}` : (r.startAt||null), distanceKm: dist, durationSec: dur,
        paceSec: parseDur($("fPace").value) || (dist && dur ? Math.round(dur/dist) : (r.paceSec??null)),
        avgHr: num($("fHr").value), maxHr: num($("fMax").value), cadence: num($("fCad").value), strideCm: num($("fStr").value),
        calories: num($("fCal").value), steps: r.steps??null, maxCadence: r.maxCadence??null, splits,
        hrZones: r.hrZones||null, trainingEffect: num($("fTE").value),
        vo2max: num($("fVO2").value), trainingLoad: num($("fLoad").value),
        recoveryHours: num($("fRec").value), vitality: num(String($("fVit").value).replace(/^\+/,"")),
        rpe: feel.rpe, fatigue: feel.fatigue, pain: $("fPain").checked, memo: $("fMemo").value.trim(),
        createdAt: r.createdAt || jstNowText()
      };
      setRun(existingId || `${date.replace(/-/g,"")}-${Date.now().toString(36)}`, data);
      if(!storageOK){ $("fErr").hidden=false; $("fErr").textContent="この端末に保存できませんでした。"; return; }
      S.sel = date; const d = fromKey(date); S.view = {y:d.getUTCFullYear(), m:d.getUTCMonth()};
      closeSheet(); S.tab="cal"; render(); toast("記録しました");
    };
  });
}

/* ---------- weekly analysis (rule-based) ---------- */
function easyPaceRange(){
  // 直近のイージー計画に入っているペースを引き継ぐ。なければ推定値
  const ks = Object.keys(DB.plans).sort().reverse();
  for(const k of ks){ const p = DB.plans[k]; const m = String(p.pace||"").match(/(\d+):(\d{2})\s*-\s*(\d+):(\d{2})/); if(p.type==="easy" && m) return [+m[1]*60+ +m[2], +m[3]*60+ +m[4]]; }
  return DEFAULT_EASY.slice();
}
const rangeTxt = ([a,b]) => `${paceTxt(a)}-${paceTxt(b)}`;
function isEasyRun(r){ const p = DB.plans[r.date]; return !p || p.type==="easy" || p.type==="recovery"; }
function km4Before(mon){ let s = 0; for(let i=0;i<4;i++) s += weekStats(addDays(mon,-7*i)).km; return s; }
function longestBefore(mon){ return Object.values(DB.runs).filter(r=>r.date>=addDays(mon,-21) && r.date<=addDays(mon,6)).reduce((a,r)=>Math.max(a,r.distanceKm||0),0); }
function buildWeeksUp(mon){ let n = 0; for(let i=0;i<4;i++){ const a = weekStats(addDays(mon,-7*i)).km, b = weekStats(addDays(mon,-7*(i+1))).km; if(a > b && b > 0) n++; else break; } return n; }

/* build one week's plan from a target distance */
function buildWeek(mon, targetKm, opts){
  const {km4, longest, easy, painRest} = opts;
  const days = d => addDays(mon,d);
  if(painRest) return [];
  targetKm = Math.max(0, targetKm);
  const pts = [];
  let layout;
  if(targetKm < 8) layout = [[2,"easy",0.45],[5,"easy",0.55]];                       // 水・土
  else if(targetKm < 14) layout = [[1,"easy",0.3],[3,"easy",0.3],[5,"easy",0.4]];   // 火・木・土
  else layout = [[1,"easy",0.25],[3,"easy",0.22],[5,"long",0.38],[6,"recovery",0.15]]; // 火・木・土・日
  const usePoint = targetKm >= 12;                                   // 量が少ないうちは強度を入れない
  const thresholdOK = km4 >= 60;                                     // 月60km未満はポイント週1回まで
  layout.forEach(([d,type,share])=>{
    let km = r05(targetKm*share);
    if(type==="long"){
      if(!usePoint) type = "easy";
      km = Math.min(km, r05(Math.max(longest,3)+2));
    }
    if(thresholdOK && d===3) type = "threshold";
    // 時間の上限：平日60分・週末90分（遅い側のペースで計算）
    const cap = (d>=5 ? 90 : 60)*60/easy[1];
    km = Math.max(1.5, Math.min(km, Math.floor(cap*2)/2));
    const pace = type==="threshold" ? "ややきつい（会話は短く）" : type==="recovery" ? rangeTxt([easy[0]+20, easy[1]+30]) : type==="long" ? rangeTxt([easy[0]+10, easy[1]+10]) : rangeTxt(easy);
    const note = type==="long" ? "ゆっくり長く。距離に慣れる" : type==="recovery" ? "前日の疲れを抜く" : type==="threshold" ? "20分のややきつい持続走" : "会話できる速さで";
    pts.push({date:days(d), action:"set", type, distanceKm:km, durationMin:null, pace, note});
  });
  // 合計が目標を超えたら土曜以外から削る
  let tot = pts.reduce((a,p)=>a+p.distanceKm,0);
  for(const p of pts){ if(tot <= targetKm+0.05) break; if(p.type==="long") continue; const cut = Math.min(p.distanceKm-1.5, r05(tot-targetKm)); if(cut>0){ p.distanceKm = r05(p.distanceKm-cut); tot -= cut; } }
  return pts;
}

function analyzeWeek(mon){
  const st = weekStats(mon), prev = weekStats(addDays(mon,-7));
  const nextMon = addDays(mon,7);
  const nextDays = [...Array(7)].map((_,i)=>addDays(nextMon,i));
  const km4 = km4Before(mon), longest = longestBefore(mon);
  let easy = easyPaceRange();
  const dataNotes = [], good = [], change = [];
  // データ品質
  const sus = st.runs.filter(hrSuspicious);
  sus.forEach(r=>dataNotes.push(`${mdw(r.date)}の心拍（平均${r.avgHr}）は体感や前後と合わないため、手首計測の誤差とみなして集計から外しました。`));
  const noFeel = st.runs.filter(r=>!r.rpe || !r.fatigue);
  if(noFeel.length) dataNotes.push(`体感強度・疲労度が未入力のランが${noFeel.length}回あります。入力すると判定が正確になります。`);
  // 判定材料
  const pain = st.runs.some(hasPain);
  const highFat = st.runs.filter(r=>r.fatigue>=4);
  const easyHard = st.runs.filter(r=>isEasyRun(r) && ((r.rpe && r.rpe>=7) || (r.avgHr && !hrSuspicious(r) && r.avgHr>EASY_HR_LIMIT)));
  const easyCalm = st.runs.filter(r=>isEasyRun(r) && r.rpe && r.rpe<=4 && (!r.avgHr || r.avgHr<=EASY_HR_LIMIT-10));
  // 良かった点
  if(st.planRuns) { if(st.doneDays/st.planRuns >= 0.75) good.push(`予定${st.planRuns}回のうち${st.doneDays}回を実施（${r1(st.km)}km）。習慣づくりとして十分です。`); }
  else if(st.runs.length) good.push(`${st.runs.length}回・${r1(st.km)}kmを走りました。`);
  if(prev.km && st.km > prev.km && st.km <= prev.km*1.15) good.push(`走行距離が前週${r1(prev.km)}km→${r1(st.km)}kmと無理のない範囲で増えています。`);
  const fats = st.runs.map(r=>r.fatigue).filter(Boolean);
  if(fats.length && Math.max(...fats)<=3) good.push(`疲労度は最大${Math.max(...fats)}/5で、負荷は適正な範囲です。`);
  // 同じペース帯で心拍が下がったか（±15秒/km）
  const past = Object.values(DB.runs).filter(r=>r.date<mon && r.date>=addDays(mon,-42) && r.avgHr && r.paceSec && !hrSuspicious(r));
  for(const r of st.runs){ if(!r.avgHr || !r.paceSec || hrSuspicious(r)) continue; const sim = past.filter(p=>Math.abs(p.paceSec-r.paceSec)<=15); if(sim.length){ const avg = sim.reduce((a,p)=>a+p.avgHr,0)/sim.length; if(r.avgHr <= avg-4){ good.push(`同じくらいのペース（${fmtPace(r.paceSec)}/km）で、心拍が以前の平均${Math.round(avg)}→${r.avgHr}に下がりました。`); break; } } }
  // 次に変える点（最大3つ）
  if(pain) change.push("痛み・違和感の記録があります。来週は走る予定を入れていません。痛みが続くなら医療機関で相談してください。");
  if(easyHard.length){ const r = easyHard[0]; change.push(`イージーのつもりの${mdw(r.date)}が${r.avgHr?`心拍${r.avgHr}（目安${EASY_HR_LIMIT}以下・推定）`:""}${r.rpe?` 体感${r.rpe}/10`:""}でした。ペースを15秒/kmほど落として、会話できる速さにしてください。`); easy = [easy[0]+15, easy[1]+15]; }
  if(highFat.length>=2) change.push(`疲労度4以上が${highFat.length}回ありました。来週は距離を15%ほど減らします。`);
  if(st.planRuns && st.doneDays/st.planRuns < 0.5 && !pain) change.push(`予定${st.planRuns}回のうち実施は${st.doneDays}回でした。来週は回数を増やさず、確実にこなせる量にしています。`);
  // 来週の目標距離
  const base = st.km || prev.km || 5;
  const ups = buildWeeksUp(mon);
  let target, reason;
  if(pain){ target = 0; reason = "痛み・違和感の記録があるため、来週は走らず様子を見る提案です。"; }
  else if(highFat.length>=2 || easyHard.length>=2){ target = base*0.85; reason = `疲れが強く出ているため、来週は今週の${r1(base)}kmから約15%減らして${r1(r05(target))}kmにします。`; }
  else if(ups>=3){ target = base*0.85; reason = `3週続けて距離を伸ばしたので、来週は回復週として${r1(r05(target))}kmに落とします。`; }
  else if(st.planRuns && st.doneDays/st.planRuns < 0.5){ target = Math.min(base*1.1, Math.max(st.km, prev.km)); reason = `予定の実施が少なかったため、来週は今週並みの${r1(r05(target))}kmにします。`; }
  else { target = base*1.1; reason = `今週${r1(base)}kmに対して+10%以内の${r1(r05(Math.min(target,base*1.1)))}km以内に収めます。`; }
  target = r05(Math.min(target, base*1.1));
  const reduce = pain || highFat.length>=2 || easyHard.length>=2 || ups>=3;
  if(easyCalm.length>=3 && !easyHard.length) reason += " イージーは余裕が出てきていますが、距離を伸ばす週なのでペースは据え置きます。";
  // 来週の現在の予定と比較
  const curNext = nextDays.map(d=>DB.plans[d]).filter(p=>p && p.type!=="rest");
  const curKm = curNext.reduce((a,p)=>a+(p.distanceKm||0),0);
  const needsPace = easyHard.length>0;
  let proposals = [];
  // 量を落とす週は、今の予定より増やす提案はしない
  if(reduce && curKm > 0 && curKm < target){ target = r05(curKm); reason += ` 来週の予定（${r1(curKm)}km）はすでにそれ以下なので、距離はそのままにします。`; }
  const lowOK = reduce ? 0 : target*0.8;
  const fine = !pain && curNext.length && curKm <= target+0.05 && curKm >= lowOK && !needsPace && curNext.filter(p=>POINT.has(p.type)).length <= (km4>=60?2:1);
  if(!fine){
    const built = buildWeek(nextMon, target, {km4, longest, easy, painRest:pain});
    const builtMap = Object.fromEntries(built.map(p=>[p.date,p]));
    nextDays.forEach(d=>{
      const cur = DB.plans[d], nw = builtMap[d];
      if(nw){ if(!cur || cur.type!==nw.type || cur.distanceKm!==nw.distanceKm || cur.pace!==nw.pace) proposals.push(nw); }
      else if(cur && cur.type!=="rest") proposals.push({date:d, action:"delete", type:cur.type, note: pain ? "休養" : "量の調整のため休み"});
    });
  } else reason = `来週の予定（${r1(curKm)}km）は、+10%以内の上限${r1(target)}kmに収まっているので変更しません。`;
  const headline = pain ? "痛み・違和感あり。まずは休むことを優先" :
    highFat.length>=2 ? "疲れが溜まり気味。来週は量を落とす" :
    easyHard.length ? "イージーが速め。来週はペースを落とす" :
    st.km ? `${r1(st.km)}km・${st.runs.length}回。この調子で少しずつ` : "走れなかった週。来週は軽めから再開";
  const runDays = Math.max(2, proposals.filter(p=>p.action==="set").length || curNext.length);
  return {
    weekStart: mon, declaration: `今週：【基礎期／週4日型／レースまで残り：未定】`,
    headline, dataNotes, good: good.slice(0,3), change: change.slice(0,3), painAlert: pain,
    proposalReason: reason, proposals, proposalStatus: proposals.length ? "pending" : "none",
    generatedAt: jstNowText(), runDays
  };
}

function generateWeek(mon, auto){
  const w = analyzeWeek(mon);
  w.generatedBy = auto ? "auto" : "manual";
  setWeek(mon, w);
  render();
}
function maybeAuto(){
  const prev = addDays(mondayOf(logicalToday()),-7);
  if(DB.weeks[prev]) return;
  const st = weekStats(prev);
  if(!st.runs.length && !st.plans.length) return;
  generateWeek(prev, true);
}
function applyProposals(mon){
  const w = DB.weeks[mon]; if(!w) return;
  (w.proposals||[]).forEach(p=>{
    if(p.action==="delete") delete DB.plans[p.date];
    else DB.plans[p.date] = {date:p.date,type:p.type,distanceKm:p.distanceKm,durationMin:p.durationMin,pace:p.pace,note:p.note,source:"auto",updatedAt:jstNowText()};
  });
  w.proposalStatus = "applied"; w.appliedAt = jstNowText();
  persist(); render(); toast("来週の予定を変更しました");
}

/* 4-week plan */
function plan4(){
  const cur = mondayOf(logicalToday());
  const start = addDays(cur,7);
  const curSt = weekStats(cur), prevSt = weekStats(addDays(cur,-7));
  const base = Math.max(curSt.km, curSt.planKm, prevSt.km) || 5;
  const km4 = km4Before(cur), longest = longestBefore(cur);
  const easy = easyPaceRange();
  const factors = [1.1, 1.1*1.1, 1.1*1.1*1.1, 1.1*1.1*0.95];
  const weeks = factors.map((f,i)=>{ const mon = addDays(start,7*i); return {mon, items: buildWeek(mon, r05(base*f), {km4, longest: longest + 2*Math.min(i,2), easy})}; });
  const items = weeks.flatMap(w=>w.items);
  let html = `<div class="decl">今週：【基礎期／週4日型／レースまで残り：未定】</div>
    <p class="small">今週の基準${r1(base)}kmから、週+10%以内で3週伸ばし、4週目は回復週として少し落とします。${km4<60?"直近4週が60km未満なので、ポイント練習は週1回まで（量が少ないうちはイージーのみ）です。":""}</p><div class="card">`;
  weeks.forEach(w=>{ const km = w.items.reduce((a,x)=>a+x.distanceKm,0); html += `<div class="flabel num" style="margin-top:4px">${md(w.mon)}週　計 ${r1(km)} km</div>`;
    w.items.forEach(p=>{ const t = TYPES[p.type]; html += `<div class="row"><span class="num" style="width:62px;font-weight:700">${mdw(p.date)}</span><span class="tag ${t.cls}">${t.label}</span><span class="num small">${p.distanceKm}km ${esc(p.pace)}</span></div>`; }); });
  html += `</div><p class="small muted">反映すると、この4週間の今ある予定はこの案に置き換わります。ペースは記録が少ないうちは推定です。</p><div class="btns"><button class="btn primary" id="p4apply">カレンダーに反映</button><button class="btn ghost" id="p4close">閉じる</button></div>`;
  openSheet(`<h3>4週間の予定案</h3>${html}`, ()=>{
    $("p4close").onclick = closeSheet;
    $("p4apply").onclick = ()=>{
      for(let i=0;i<28;i++){ const d = addDays(start,i); delete DB.plans[d]; }
      items.forEach(p=>DB.plans[p.date] = {date:p.date,type:p.type,distanceKm:p.distanceKm,durationMin:null,pace:p.pace,note:p.note,source:"auto",updatedAt:jstNowText()});
      persist(); closeSheet(); S.tab="cal"; const f = fromKey(start); S.view={y:f.getUTCFullYear(),m:f.getUTCMonth()}; S.sel=start; render(); toast("予定を反映しました");
    };
  });
}

/* ---------- consult with any AI (Claude / Gemini / ChatGPT) ---------- */
const DEFAULT_PROFILE = `20代。故障・痛みなし、持病なし。
目標：健康のためのランニング。いずれハーフマラソン1:40:00、4:00〜4:30/kmで10km〜ハーフを走れるようになりたい。レース日は未定。
練習環境：週4日程度走れる。平日60分・週末90分まで。夜23〜24時に走り始める。起伏の少ない道路。
計測：Xiaomi Smart Band 10（手首の光学式心拍）、アプリはMi Fitness。
自己ベスト：なし（中学時代の1500m 5:08）。`;
const getProfile = () => DB.profile || DEFAULT_PROFILE;

function runDetail(r){
  const p = DB.plans[r.date];
  return [
    `■ ${mdw(r.date)} ${String(r.startAt||"").slice(11,16)}開始（予定：${p?(TYPES[p.type]||TYPES.easy).label+(p.distanceKm?" "+p.distanceKm+"km":"")+(p.pace?" "+p.pace+"/km":""):"なし"}）`,
    `距離 ${r.distanceKm??"?"}km／時間 ${fmtDur(r.durationSec)}／平均ペース ${fmtPace(r.paceSec)}/km`,
    `心拍 平均${r.avgHr??"?"}・最大${r.maxHr??"?"}${hrSuspicious(r)?"（手首計測の誤差の可能性あり）":""}／ケイデンス ${r.cadence??"?"}／ストライド ${r.strideCm??"?"}cm`,
    (r.splits||[]).length ? `km毎ペース：${r.splits.map(fmtPace).join(" ")}` : "",
    r.hrZones ? `心拍ゾーン（Mi Fitness）：ウォームアップ${fmtDur(r.hrZones.warmup)||"0"} インテンシブ${fmtDur(r.hrZones.intensive)||"0"} 有酸素${fmtDur(r.hrZones.aerobic)||"0"} 無酸素${fmtDur(r.hrZones.anaerobic)||"0"} 最大${fmtDur(r.hrZones.vo2max)||"0"}` : "",
    [r.vo2max?`VO2max ${r.vo2max}`:"", r.trainingLoad?`トレーニング負荷 ${r.trainingLoad}`:"", r.trainingEffect?`効果の評価 ${r.trainingEffect}`:"", r.recoveryHours?`回復 ${r.recoveryHours}時間`:"", r.vitality!=null?`活力スコア ${r.vitality>0?"+":""}${r.vitality}`:"", r.calories?`活動 ${r.calories}kcal`:""].filter(Boolean).join("／"),
    `体感強度 ${r.rpe??"未入力"}/10／疲労度 ${r.fatigue??"未入力"}/5／痛み・違和感 ${hasPain(r)?"あり":"なし"}${r.memo?`／メモ：${r.memo}`:""}`
  ].filter(Boolean).join("\n");
}
function planList(days){
  return days.map(d=>{ const p = DB.plans[d]; return `${d}（${WD[dow(d)]}） ${p ? `${(TYPES[p.type]||TYPES.easy).label}${p.distanceKm?" "+p.distanceKm+"km":""}${p.durationMin?" "+p.durationMin+"分":""}${p.pace?" "+p.pace+"/km":""}${p.note?"（"+p.note+"）":""}` : "予定なし"}`; }).join("\n");
}
function buildConsultText(mon){
  const st = weekStats(mon);
  const days = st.days, next = [...Array(7)].map((_,i)=>addDays(mon,7+i));
  const isCur = mon===mondayOf(logicalToday());
  const hist = [1,2,3,4].map(i=>{ const m = addDays(mon,-7*i); const s = weekStats(m); return `${md(m)}〜${md(addDays(m,6))}：${r1(s.km)}km／${s.runs.length}回／最長${r1(s.longest)}km／体感強度平均${s.avgRpe?r1(s.avgRpe):"—"}／疲労度最大${s.maxFatigue??"—"}`; }).join("\n");
  const w = DB.weeks[mon];
  return `あなたは市民ランナーのランニングコーチです。下のデータをもとに、この週の振り返りと、来週の予定の見直しをしてください。

【ランナー】
${getProfile()}

【守ってほしいルール】
・医療的な診断はしない。痛み・違和感の記録があれば、走るメニューより先に休むことを提案し、続くなら受診を勧める
・週間走行距離は前週の実績から+10%以内。ロング走は直近の最長+2kmまで。3週伸ばしたら1週落とす
・直近4週の合計が60km未満のうちは、ポイント練習（閾値走・インターバル・レースペース走・ロング）は週1回まで
・距離とペースを同じ週に同時に上げない。ペースを上げるのは、設定より速く楽に走れた回が2〜3回続いたときだけ
・イージーは会話できる速さ。イージーなのに心拍や体感強度が高ければ指摘する
・手首の光学式心拍は誤作動することがある。明らかにおかしい値は除外して、除外したと書く
・指摘は3つまで。数値の根拠をつける

【この週】${md(mon)}〜${md(addDays(mon,6))}${isCur?"（まだ途中）":""}
合計 ${r1(st.km)}km／${st.runs.length}回／平均ペース ${fmtPace(st.avgPace)}/km／平均心拍 ${st.avgHr?Math.round(st.avgHr):"—"}
予定 ${r1(st.planKm)}km、予定日の実施 ${st.doneDays}/${st.planRuns}回
日付は朝5時区切り（5時より前に走った分は前日扱い）。

【この週の予定】
${planList(days)}

【この週のラン】
${st.runs.map(runDetail).join("\n\n") || "走っていません"}

【それより前の4週】
${hist}

【来週の今の予定】
${planList(next)}
${w ? `\n【アプリの自動判定（参考）】\n${w.headline}／${w.proposalReason}` : ""}

【回答の形式】
1. この週の振り返り（良かった点・次に変える点）
2. 来週の予定の見直し案と、その理由
3. 最後に、来週の予定を次の形式だけで書いた「予定変更」ブロック。変更しない日も含めて7日分すべて書く。種類は イージー／リカバリー／ロング／閾値走／インターバル／レースペース／休み のどれか。
\`\`\`
予定変更
YYYY-MM-DD 種類 距離km ペース メモ
\`\`\`
例：
\`\`\`
予定変更
${next[0]} 休み
${next[2]} イージー 3km 6:50-7:20 会話できる速さで
\`\`\``;
}

function openAsk(mon){
  const text = buildConsultText(mon);
  openSheet(`<h3>AIに相談する</h3>
    <div class="small muted">下の文章をコピーして、Claude・Gemini・ChatGPTのどれかに貼り付けて送ってください。回答の最後に「予定変更」が書かれていれば、そのままこのアプリに貼り付けて予定に反映できます。</div>
    <div class="btns"><button class="btn primary" id="askCopy">コピー</button>${navigator.share?`<button class="btn ghost" id="askShare">共有</button>`:""}</div>
    <div class="field"><label for="askTxt">相談用の文章</label><textarea id="askTxt" rows="12" readonly>${esc(text)}</textarea></div>`, ()=>{
    $("askCopy").onclick = async()=>{
      try{ await navigator.clipboard.writeText(text); toast("コピーしました"); }
      catch(e){ const t = $("askTxt"); t.focus(); t.select(); toast("文章を選択しました。コピーしてください"); }
    };
    const sh = $("askShare"); if(sh) sh.onclick = ()=>navigator.share({text}).catch(()=>{});
  });
}

const TYPE_BY_LABEL = {"イージー":"easy","ジョグ":"easy","リカバリー":"recovery","ロング":"long","ロング走":"long","閾値":"threshold","閾値走":"threshold","テンポ走":"threshold","ペース走":"threshold","インターバル":"interval","レースペース":"race","レースペース走":"race","休み":"rest","休養":"rest","完全休養":"rest"};
function parsePlanBlock(text){
  const out = [];
  const t = normalizeOcr(text).replace(/[ 　\t]+/g," ");
  t.split(/\n/).forEach(line=>{
    const m = line.match(/(20\d\d)[-\/.](\d{1,2})[-\/.](\d{1,2})\s*(?:\([^)]*\)|（[^）]*）)?\s*(\S+)(.*)$/);
    if(!m) return;
    const date = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    const type = TYPE_BY_LABEL[m[4].replace(/[：:]/g,"")];
    if(!type) return;
    let rest = m[5].trim();
    const km = rest.match(/(\d+(?:\.\d+)?)\s*km/i); if(km) rest = rest.replace(km[0],"").trim();
    const min = rest.match(/(\d+)\s*分/); if(min) rest = rest.replace(min[0],"").trim();
    const pace = rest.match(/\d{1,2}[:'’]\d{2}(?:\s*[-〜~]\s*\d{1,2}[:'’]\d{2})?(?:\s*\/\s*km)?/); if(pace) rest = rest.replace(pace[0],"").trim();
    out.push({date, type, distanceKm: km?+km[1]:null, durationMin: min?+min[1]:null, pace: pace?pace[0].replace(/\s*\/\s*km/i,"").replace(/[’']/g,":").replace(/[〜~]/,"-").replace(/\s+/g,""):"", note: rest.replace(/^[-・:：\s]+/,"").slice(0,40)});
  });
  return out;
}

function openPaste(mon){
  const next = new Set([...Array(7)].map((_,i)=>addDays(mon,7+i)));
  openSheet(`<h3>AIの回答を予定に反映</h3>
    <div class="small muted">AIの回答をまるごと貼り付けてください。「予定変更」の行（日付・種類・距離・ペース）を読み取ります。</div>
    <div class="field"><label for="pasteTxt">回答</label><textarea id="pasteTxt" rows="8" placeholder="${next.values().next().value} イージー 3km 6:50-7:20 会話できる速さで"></textarea></div>
    <button class="btn ghost" id="pasteRead">読み取る</button>
    <div id="pastePrev"></div>`, ()=>{
    $("pasteRead").onclick = ()=>{
      const items = parsePlanBlock($("pasteTxt").value);
      const area = $("pastePrev");
      if(!items.length){ area.innerHTML = `<div class="note">予定の行が見つかりませんでした。「2026-11-04 イージー 3km 6:50-7:20」のような行が入っているか確認してください。</div>`; return; }
      const outside = items.filter(p=>!next.has(p.date)).length;
      area.innerHTML = `<div class="card">${items.map(p=>{ const t = TYPES[p.type]; const cur = DB.plans[p.date];
        return `<div class="prop"><b class="num">${mdw(p.date)}</b><div><div class="small muted">現在：${cur?(TYPES[cur.type]||TYPES.easy).label+(cur.distanceKm?" "+cur.distanceKm+"km":""):"なし"}</div><div><span class="tag ${t.cls}">${t.label}</span> <span class="num">${p.distanceKm?p.distanceKm+"km":""} ${p.durationMin?p.durationMin+"分":""} ${esc(p.pace)}</span></div>${p.note?`<div class="small muted">${esc(p.note)}</div>`:""}</div></div>`; }).join("")}</div>
        ${outside?`<div class="note small">来週以外の日付が${outside}件あります。そのまま反映します。</div>`:""}
        <button class="btn primary" id="pasteApply">この内容で予定を変更</button>`;
      $("pasteApply").onclick = ()=>{
        items.forEach(p=>{ if(p.type==="rest") delete DB.plans[p.date]; else DB.plans[p.date] = {date:p.date,type:p.type,distanceKm:p.distanceKm,durationMin:p.durationMin,pace:p.pace,note:p.note,source:"ai",updatedAt:jstNowText()}; });
        if(DB.weeks[mon]) DB.weeks[mon].proposalStatus = "dismissed";
        persist(); closeSheet(); S.tab="cal"; const f = fromKey(items[0].date); S.view={y:f.getUTCFullYear(),m:f.getUTCMonth()}; S.sel=items[0].date; render(); toast("予定に反映しました");
      };
    };
  });
}

/* ---------- backup ---------- */
function exportData(){
  const blob = new Blob([JSON.stringify(DB,null,1)], {type:"application/json"});
  const name = `runbook-${logicalToday()}.json`;
  const file = new File([blob], name, {type:"application/json"});
  if(navigator.canShare && navigator.canShare({files:[file]})){ navigator.share({files:[file], title:name}).catch(()=>{}); return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function importData(file){
  const fr = new FileReader();
  fr.onload = ()=>{ try{ const d = JSON.parse(fr.result); if(!d || typeof d.runs!=="object" || typeof d.plans!=="object") throw 0;
    DB = {runs:d.runs, plans:d.plans, weeks:d.weeks||{}, profile:d.profile||null, createdAt:d.createdAt||jstNowText()}; persist(); render(); toast("データを読み込みました"); }
    catch(e){ toast("このファイルは読み込めません"); } };
  fr.readAsText(file);
}

/* ---------- events ---------- */
document.addEventListener("click", e=>{
  if(e.target.id==="exportBtn"){ exportData(); return; }
  if(e.target.id==="profSave"){ DB.profile = $("profTxt").value.trim() || null; persist(); toast("プロフィールを保存しました"); return; }
  const t = e.target.closest("[data-day],[data-edit-plan],[data-new-run],[data-run],[data-gen],[data-apply],[data-dismiss],[data-plan4],[data-goto-weeks],[data-ask],[data-paste],.tab");
  if(!t) return;
  if(t.classList.contains("tab")){ S.tab = t.dataset.tab; render(); window.scrollTo(0,0); return; }
  if(t.dataset.day){ S.sel = t.dataset.day; render(); return; }
  if(t.dataset.editPlan){ openPlan(t.dataset.editPlan); return; }
  if(t.dataset.newRun){ openNewRun(t.dataset.newRun); return; }
  if(t.dataset.run){ openRun(t.dataset.run); return; }
  if(t.dataset.gen){ generateWeek(t.dataset.gen, false); toast("まとめを作りました"); return; }
  if(t.dataset.apply){ applyProposals(t.dataset.apply); return; }
  if(t.dataset.dismiss){ DB.weeks[t.dataset.dismiss].proposalStatus = "dismissed"; persist(); render(); return; }
  if(t.dataset.plan4){ plan4(); return; }
  if(t.dataset.ask){ openAsk(t.dataset.ask); return; }
  if(t.dataset.paste){ openPaste(t.dataset.paste); return; }
  if(t.dataset.gotoWeeks){ S.tab="weeks"; render(); window.scrollTo(0,0); return; }
});
document.addEventListener("change", e=>{ if(e.target.id==="importFile" && e.target.files[0]) importData(e.target.files[0]); });
$("fab").onclick = ()=>openNewRun(S.tab==="cal"?S.sel:logicalToday());
$("prev").onclick = ()=>{ S.view.m--; if(S.view.m<0){S.view.m=11;S.view.y--;} render(); };
$("next").onclick = ()=>{ S.view.m++; if(S.view.m>11){S.view.m=0;S.view.y++;} render(); };
$("todayBtn").onclick = ()=>{ const t = fromKey(logicalToday()); S.view={y:t.getUTCFullYear(),m:t.getUTCMonth()}; S.sel=logicalToday(); render(); };
document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeSheet(); });
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden){ maybeAuto(); render(); } });

maybeAuto();
render();
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
if(typeof module!=="undefined") module.exports = {parseMiFitness, analyzeWeek, buildWeek, logicalDateOf, buildConsultText, parsePlanBlock};
