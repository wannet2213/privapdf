import { Link } from 'react-router-dom'; import { tools } from '../tools/registry'; import { ToolIcon, TOOL_COLORS } from '../components/ToolIcon';

const UploadIcon = () => (
  <svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 15.5V5" /><path d="m7.5 9.5 4.5-4.5 4.5 4.5" /><path d="M4 16.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2.5" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m4.5 12.5 5 5 10-11" />
  </svg>
);

export function Home(){return <div className="home"><section className="hero"><div className="eyebrow">PRIVATE BY DEFAULT / 01</div><h1>PDF tools yang<br/><em>tetap milikmu.</em></h1><p>Gabungkan, pisahkan, dan rapikan dokumen langsung di browser. Tanpa akun. Tanpa upload.</p><Link className="drop" to="/tools"><strong className="drop-icon" aria-hidden="true"><UploadIcon/></strong><span>Pilih tool untuk mulai</span><small>File dipilih di workspace, maksimal 50 MB</small></Link><div className="proof"><span><CheckIcon/> data stays in memory</span><span><CheckIcon/> no telemetry</span></div></section><section className="tools"><div className="section-label">CORE WORKBENCH</div><div className="tool-grid">{tools.map((t,i)=><Link className={`tool-card ${t.capability===false?'muted':''}`} to={`/tools/${t.id}`} key={t.id}><span className="tool-card-icon" style={{color:TOOL_COLORS[t.id]}}><ToolIcon id={t.id}/></span><b>0{i+1}</b><h3>{t.label}</h3><p>{t.description}</p></Link>)}</div></section></div>}
