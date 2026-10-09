import { metrics, onChange, state } from './store.js';
import { onAuthChange, session } from './auth.js';

const MASCOTS = {
  bonvallet: {
    name: 'Eduardo Bonvallet',
    avatars: {
      neutral: 'https://s.t13.cl/sites/default/files/styles/manualcrop_1600x800/public/t13/field-imagen/2015-09/1442590410-auno1203211dea4.jpg.jpeg?itok=_CMLOtE2',
      serious: 'https://static.emol.cl/emol50/fotos/2015/09/18/file_20150918122059.jpg',
      ironic: 'https://img.soy-chile.cl/Fotos/2016/12/26/file_20161226184555.jpg'
    },
    quotes: {
      arenga: [
        { mood:'serious', text:'¡Levántate chileno!' },
        { mood:'neutral', text:'Créete el cuento chileno.' },
        { mood:'neutral', text:'Ya te creíste el cuento chileno.' },
        { mood:'ironic', text:'Avíspate reweón, avíspate, ¡grita!' },
        { mood:'serious', text:'Sal a la calle a luchar.' },
        { mood:'serious', text:'Para ser campeones, para ganar hay que ser guerrero, fakir y monje.' },
        { mood:'serious', text:'Ir de frente.' }
      ],
      levantarse: [
        { mood:'serious', text:'Es bueno conocer la derrota.' },
        { mood:'serious', text:'A los grandes hombres las derrotas los hacen más grandes, pero primero hay que levantarse.' },
        { mood:'serious', text:'Nunca se tiene que perder la dignidad, la fortaleza. Hay que luchar contra el dolor.' },
        { mood:'neutral', text:'Me tuvo mal, pero me estoy levantando.' }
      ],
      foco: [
        { mood:'neutral', text:'Mira el horizonte.' },
        { mood:'ironic', text:'Las águilas no cazan moscas.' },
        { mood:'serious', text:'Monje, fakir o guerrero, o sencillamente te pierdes.' },
        { mood:'neutral', text:'No debe precipitarse, debe tomarse todo el tiempo del mundo.' },
        { mood:'neutral', text:'Tiene que aprender a escuchar.' }
      ],
      confianza: [
        { mood:'neutral', text:'Créete el cuento chileno.' },
        { mood:'neutral', text:'Ya te creíste el cuento chileno.' },
        { mood:'ironic', text:'Soy tu sensei, tu Dalai Lama, soy el mejor, soy el Gurú.' }
      ],
      humor: [
        { mood:'neutral', text:'Diviértanse, yo sólo pienso.' },
        { mood:'ironic', text:'Me llevo toda la audiencia porque soy un genio.' },
        { mood:'ironic', text:'Soy un todo.' },
        { mood:'ironic', text:'Yo soy el genio de la historia en este país.' }
      ]
    }
  },
  nicanor: {
    name: 'Nicanor Parra',
    avatars: {
      neutral: 'data:image/webp;base64,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',
      serious: 'data:image/webp;base64,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',
      ironic: 'data:image/webp;base64,UklGRiQFAABXRUJQVlA4IBgFAABQJACdASpwAHAAPqVCmkomJCKhuhc8cMAUiWUAxJSP/nZt6ASTvABWT3q5nzEkKaz+EPZmgvV/OPhASP0jRZGdAwe0bL1M8swY4eR9zhohonOYoGkwHrvOrkdtvClsLlP3Z+mVyzM6WSDqaIqVbMecGl3bZU54TQGuGSa4ydjXmmt0QlgzGnF7W3ESWdJyTj44FeeIgJETNRi5MNemdPySg03EP13xz4VnfU2bukpB0qgFWWI6q1MeuUnHXsDDAfYPdJganNKY6PdUyib9yklQOmtlWgAKpNtDM//odxkpqzOkGDyODZA5LZZroPm35pyzGXOz2EebSo0SRX5ClTxxBvHOXNF0BFLKUUErMzbYQ7ltu/76yMFJ3qKPWXjLQOXOyHxoCka3aXdAAAD++6p246Xv9zd111PMFrjnw116xaL0fqPEYGzYzbhtYEMjbUNvLPlomUrx72gtSjfEPDLe0kZn89d1GjIPANuKJ5J8kwO5njd5tDHIFTimChEkInjd0Thcc/DX2kn1W+BB8qYH+bu5DrozGufY6y+KGPJTaRfDoNNbUGRHwiKN5jlTTpeWx3TIVC5dXbwPwEPn7weFhTEFF6y2oqPY4+BY06yHNlmRB9WndJZu6TgkKjSsMspZdJQTZN9IU8xPuhkicXjuytUDdWZZ5W4fl5OyL3YcitRWOUSSxAlcC4aHs7FPeYNNTwE+b8IoTk4uNiU0SLJiC27r/7uIKg3s+oVHA6gurMpy2ql5dxRZSbaD0LQE5nofnBRduEUawOZ8kvgyv9jguAzrLGz/g45gzfDVX+yjYYWTAGp0yFv7KB1NgpTafe7da2PJdqm2miZyTXvLzXJdYEOzPijPijpT7OKHPsSXJuFVVoqWh60XfOYYg4AMtaY7H0huRXM1RPKHIzQeFw3EQ329b8R/9LP5fr6fEowTYgbiPW7g+IFcXOOLDDnZTHYbiVjdlHBtl7A8M1rGS6iwOtYYj40yORGhqyQQNDCSCf2qe6vWU5skUBTXpXd3/Oue/ASLbGp3guG7PTQ40I2VxH6cbAZOR2H/pVX1yUX+cpNXm6C3Dq6vrgf4EGCsx9F4+f1jsx1e982kyfeayg3H9eECz9u2jHlzKennx093q6lYdP/Wql8JniIqGwzxAnHCUBYxlSfh5inbKSK58Urw5SWyrROIvq0GEvgJTlcQTwBjDut6rI9WartnL1OOmS1sQbZz44KZ9tgvTJaRan24YvZgc1g5Mj9q8h8IzsEkrO5ISG9xkB6w+9T711jFmdPnPttcM73IM4XsECDn4to1BRJtR+cUdOcvIjseRJzWkprP1itAYVQgoHYAKjXM3hYvXjN4QP+WUiCplOg7dhDlyowycMIrrjwcHHHQG0wqUCGRLQIBk/5JJaJfdd8KMj6RGfdWOd1tvl7u96IkyjDcChQfOW9NIsMb+8JY42YiDaOpccRpWI8yOKeqtRyo5bJAmrzvL8STwpQpf7OkWDuDw7mCIlRbGyUxmwObc8vjSJNo4UzfqbHSQsSACp8saF/mh3dLa6ySRMO2h63SEMfQwJe1Td4IsxFIhDfNfzwyiPnOkktd5t/ggpF1mvSlpYDQcJbfGazNZCIsK4/rW/e77Q4riLa72HK4b8oqHJi3w+YwrXEAXBrIVlfD/W14+egVSZ7NXEXLDuzIaAGPXcMmSF/BgInizAYe1kN9YLSx0rMrfV4hSEuVLN08c0dpxwVo/72RxCgAAA=='
    },
    quotes: {
      arenga: [
        { mood:'ironic', text:'En poesía se permite todo.' },
        { mood:'serious', text:'Creemos ser país y la verdad es que somos apenas paisaje.' },
        { mood:'ironic', text:'Pido que me den el Nobel por razones humanitarias.' }
      ],
      levantarse: [
        { mood:'serious', text:'La muerte es un hábito colectivo.' },
        { mood:'serious', text:'Toda lucha fratricida. Todo pensamiento vano.' },
        { mood:'neutral', text:'Fui lo que fui: una mezcla de vinagre y aceite de comer.' }
      ],
      foco: [
        { mood:'ironic', text:'Hay dos panes. Usted se come dos. Yo ninguno. Consumo promedio: un pan por persona.' },
        { mood:'ironic', text:'No nos echemos tierra a los ojos: el automóvil es una silla de ruedas.' },
        { mood:'neutral', text:'Casa Blanca. Casa de las Américas. Casa de orates.' }
      ],
      confianza: [
        { mood:'ironic', text:'Cuba sí, yankees también.' },
        { mood:'neutral', text:'En poesía se permite todo.' },
        { mood:'ironic', text:'¡Un embutido de ángel y bestia!' }
      ],
      humor: [
        { mood:'ironic', text:'Pido que me den el Nobel por razones humanitarias.' },
        { mood:'ironic', text:'Cuba sí, yankees también.' },
        { mood:'ironic', text:'¡Un embutido de ángel y bestia!' }
      ]
    }
  }
};

const MASCOT_PREF_PREFIX='crm.personal.mascot.enabled';
const MASCOT_CHARACTER_PREFIX='crm.personal.mascot.character';

let hideTimer=null;
let snapshot=null;
let lastShownAt=0;
let startupShownForUser='';
let recentQuotes=[];

function enabledKey(){ return `${MASCOT_PREF_PREFIX}:${session.user?.id || 'default'}`; }
function characterKey(){ return `${MASCOT_CHARACTER_PREFIX}:${session.user?.id || 'default'}`; }

export function isMascotEnabled(){
  if(typeof state.me?.mascotEnabled === 'boolean') return state.me.mascotEnabled;
  try { return localStorage.getItem(enabledKey()) !== '0'; } catch { return true; }
}
export const isBonvalletEnabled=isMascotEnabled;

export function currentMascotId(){
  if(state.me?.mascotCharacter === 'nicanor') return 'nicanor';
  if(state.me?.mascotCharacter === 'bonvallet') return 'bonvallet';
  try { return localStorage.getItem(characterKey()) === 'nicanor' ? 'nicanor' : 'bonvallet'; }
  catch { return 'bonvallet'; }
}

function currentMascot(){ return MASCOTS[currentMascotId()] || MASCOTS.bonvallet; }

function writeEnabled(enabled){
  try { localStorage.setItem(enabledKey(), enabled ? '1' : '0'); } catch {}
}
function writeCharacter(id){
  try { localStorage.setItem(characterKey(), id); } catch {}
}

function capture(m){
  return {
    won:m?.won?.length || 0,
    lost:m?.lost?.length || 0,
    overdue:m?.overdue?.length || 0,
    stale:m?.stale?.length || 0,
    open:m?.open?.length || 0
  };
}

function hideMascot({ immediate=false }={}){
  clearTimeout(hideTimer);
  const host=document.getElementById('bonvalletMessage');
  if(!host) return;
  host.classList.remove('is-visible');
  if(immediate){ host.hidden=true; return; }
  window.setTimeout(()=>{ if(!host.classList.contains('is-visible')) host.hidden=true; },380);
}

export function setBonvalletEnabled(enabled){
  const next=Boolean(enabled);
  writeEnabled(next);
  if(!next){
    snapshot=null;
    startupShownForUser='';
    hideMascot({immediate:true});
    return;
  }
  snapshot=capture(metrics());
  startupShownForUser=session.user?.id || '';
}

export function setMascotCharacter(id){
  const next=id === 'nicanor' ? 'nicanor' : 'bonvallet';
  writeCharacter(next);
  recentQuotes=[];
  snapshot=capture(metrics());
  hideMascot({immediate:true});
  if(session.status === 'signed-in' && isMascotEnabled()){
    window.setTimeout(()=>showMascotMessage({ ...startupMessage(metrics()), duration:6200, force:true }),120);
  }
}

function ensureHost(){
  let host=document.getElementById('bonvalletMessage');
  if(host) return host;
  host=document.createElement('aside');
  host.id='bonvalletMessage';
  host.className='bonvallet-message';
  host.setAttribute('role','status');
  host.setAttribute('aria-live','polite');
  host.setAttribute('aria-atomic','true');
  host.hidden=true;
  host.innerHTML=`
    <img class="bonvallet-message__avatar" alt="" />
    <div class="bonvallet-message__content">
      <div class="bonvallet-message__meta">
        <strong></strong>
        <span>ahora</span>
      </div>
      <p class="bonvallet-message__text"></p>
    </div>`;
  document.body.append(host);
  return host;
}

function rememberQuote(text){
  recentQuotes=[text,...recentQuotes.filter((item)=>item!==text)].slice(0,5);
}
function pickFromQuotes(quotes=[]){
  const candidates=quotes.filter((quote)=>!recentQuotes.includes(quote.text));
  const pool=candidates.length ? candidates : quotes;
  if(!pool.length) return null;
  return pool[Math.floor(Math.random()*pool.length)];
}
function allQuotes(){
  return [...new Map(Object.values(currentMascot().quotes).flat().map((q)=>[q.text,q])).values()];
}
function pickGeneralQuote(){
  const q=currentMascot().quotes;
  const roll=Math.random();
  if(roll<0.30) return pickFromQuotes(q.arenga);
  if(roll<0.52) return pickFromQuotes(q.confianza);
  if(roll<0.76) return pickFromQuotes(q.foco);
  if(roll<0.90) return pickFromQuotes(q.levantarse);
  return pickFromQuotes(q.humor);
}
function rotatingMessage(m=metrics()){
  const s=capture(m);
  const q=currentMascot().quotes;
  if(s.overdue>0 && Math.random()<0.68) return pickFromQuotes([...q.arenga,...q.levantarse]) || pickGeneralQuote();
  if(s.stale>0 && Math.random()<0.68) return pickFromQuotes(q.foco) || pickGeneralQuote();
  if(s.won>0 && Math.random()<0.55) return pickFromQuotes(q.confianza) || pickGeneralQuote();
  return pickGeneralQuote() || allQuotes()[0];
}
function startupMessage(m){
  const s=capture(m);
  const q=currentMascot().quotes;
  if(s.overdue>0) return pickFromQuotes([...q.arenga,...q.levantarse]) || allQuotes()[0];
  if(s.stale>0) return pickFromQuotes(q.foco) || allQuotes()[0];
  if(s.won>0) return pickFromQuotes(q.confianza) || allQuotes()[0];
  return rotatingMessage(m);
}

export function showMascotMessage({ text,mood='neutral',duration=7000,force=false }){
  if(!text || session.status!=='signed-in' || !isMascotEnabled()) return;
  const now=Date.now();
  if(!force && now-lastShownAt<8000) return;

  const mascot=currentMascot();
  const host=ensureHost();
  const avatar=host.querySelector('.bonvallet-message__avatar');
  const name=host.querySelector('.bonvallet-message__meta strong');
  const message=host.querySelector('.bonvallet-message__text');

  name.textContent=mascot.name;
  avatar.src=mascot.avatars[mood] || mascot.avatars.neutral;
  avatar.onerror=()=>{ if(avatar.src!==mascot.avatars.neutral) avatar.src=mascot.avatars.neutral; };
  message.textContent=text;

  clearTimeout(hideTimer);
  host.dataset.mood=mood;
  host.dataset.character=currentMascotId();
  host.hidden=false;
  requestAnimationFrame(()=>requestAnimationFrame(()=>host.classList.add('is-visible')));

  lastShownAt=now;
  rememberQuote(text);
  hideTimer=setTimeout(()=>hideMascot(),duration);
}
export const showBonvalletMessage=showMascotMessage;

export function startBonvallet(m=metrics()){
  snapshot=capture(m);
  showMascotMessage({ ...startupMessage(m),duration:6200,force:true });
}

export function syncBonvallet(m=metrics()){
  const next=capture(m);
  if(!snapshot){ snapshot=next; return; }
  const q=currentMascot().quotes;
  let message=null;
  if(next.won>snapshot.won) message=pickFromQuotes(q.confianza);
  else if(next.lost>snapshot.lost) message=pickFromQuotes(q.levantarse);
  else if(next.overdue>snapshot.overdue) message=pickFromQuotes([...q.arenga,...q.levantarse]);
  else if(next.stale>snapshot.stale) message=pickFromQuotes(q.foco);
  snapshot=next;
  if(message) showMascotMessage(message);
}

export function resetBonvallet(){
  snapshot=null;
  lastShownAt=0;
  startupShownForUser='';
  clearTimeout(hideTimer);
  recentQuotes=[];
  hideMascot({immediate:true});
}

function startupSessionKey(userId){
  return `crm.personal.mascot.startup:${userId}:${currentMascotId()}`;
}

function showStartupOnce(){
  const userId=session.user?.id || '';
  if(!isMascotEnabled() || session.status!=='signed-in' || !userId || startupShownForUser===userId) return;

  try{
    if(sessionStorage.getItem(startupSessionKey(userId))==='1'){
      startupShownForUser=userId;
      snapshot=capture(metrics());
      return;
    }
  }catch{}

  startupShownForUser=userId;
  window.setTimeout(()=>{
    if(session.status!=='signed-in' || session.user?.id!==userId || !isMascotEnabled()) return;
    try{ sessionStorage.setItem(startupSessionKey(userId),'1'); }catch{}
    startBonvallet(metrics());
  },3500);
}

onChange(()=>{
  if(session.status!=='signed-in' || !isMascotEnabled()) return;
  if(!startupShownForUser){ showStartupOnce(); return; }
  syncBonvallet(metrics());
});

onAuthChange((auth)=>{
  if(auth.status==='signed-in') showStartupOnce();
  else if(auth.status==='signed-out' || auth.status==='profile-error') resetBonvallet();
});

document.addEventListener('crm-personal:mascot-preference',(event)=>{
  setBonvalletEnabled(Boolean(event.detail?.enabled));
});

document.addEventListener('crm-personal:mascot-character',(event)=>{
  setMascotCharacter(event.detail?.character);
});

window.addEventListener('storage',(event)=>{
  if(event.key===enabledKey()) setBonvalletEnabled(event.newValue!=='0');
  if(event.key===characterKey()) setMascotCharacter(event.newValue);
});

if(session.status==='signed-in') showStartupOnce();
