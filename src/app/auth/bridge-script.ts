/**
 * Builds the inline script that runs **before the first paint** of `/auth`.
 *
 * Why it cannot be a `useEffect`: Atlas Console opens our URL with `_blank` and
 * posts to the resulting window. If our listener only exists once React has
 * hydrated, a message that arrives during document parse is dropped and a
 * working SSO reads as broken. Crazy Cake's own debugging table calls this out
 * ("No recibe postMessage -> listener no activo").
 *
 * So this script, rendered inline in the server HTML, does three things in
 * order, synchronously, while the document is still parsing:
 *   1. registers the `message` listener,
 *   2. buffers whatever arrives until the view subscribes,
 *   3. posts `PROMOTE_READY` to `window.opener`, once per allowed origin.
 *
 * The token is never logged, never stringified into the DOM, and never leaves
 * the in-memory buffer.
 */
import {
  ATLAS_BRIDGE_GLOBAL,
  ATLAS_MESSAGE_TYPE,
  PROMOTE_READY_TYPE,
} from './atlas-bridge';

/** Cap on buffered messages, so a hostile page cannot grow it without bound. */
export const BRIDGE_BUFFER_LIMIT = 20;

export interface BridgeScriptOptions {
  /** Exact origins from `NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS`. */
  allowedOrigins: readonly string[];
  /**
   * Development only. Adds `location.origin` to the allowlist so the local
   * simulator can drive the page. Always false in production, and false when
   * the page is opened with `?origins=strict`.
   */
  allowSelfOrigin: boolean;
}

/**
 * Serialises a value for embedding inside a `<script>` body. Escaping `<` is
 * what stops a value from closing the tag early; the line separators are
 * escaped because they are literal newlines to a JS parser.
 */
function embed(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function buildBridgeScript({
  allowedOrigins,
  allowSelfOrigin,
}: BridgeScriptOptions): string {
  return `(function(){
var G=${embed(ATLAS_BRIDGE_GLOBAL)};
if(window[G]){return;}
var ALLOWED=${embed(Array.from(allowedOrigins))};
if(${embed(allowSelfOrigin)}&&ALLOWED.indexOf(location.origin)===-1){ALLOWED.push(location.origin);}
var LIMIT=${embed(BRIDGE_BUFFER_LIMIT)};
var AUTH=${embed(ATLAS_MESSAGE_TYPE)};
var READY=${embed(PROMOTE_READY_TYPE)};
var bridge={version:1,startedAt:Date.now(),allowedOrigins:ALLOWED,buffer:[],ignoredCount:0,
readySignal:{hasOpener:false,postedTo:[],failedFor:[],at:0},subscriber:null,
subscribe:function(fn){bridge.subscriber=fn;var pending=bridge.buffer.slice();bridge.buffer.length=0;
for(var i=0;i<pending.length;i++){pending[i].buffered=true;try{fn(pending[i]);}catch(e){}}
return function(){if(bridge.subscriber===fn){bridge.subscriber=null;}};},
// Drops the token from ONE message, and only the one handed in. The view calls
// this after it has taken the token, never before: destroying it on the way past
// would turn any failure between reading and using it into an intermittent
// broken sign-in, which is worse than the window being closed.
scrub:function(message){
if(message&&message.payload&&typeof message.payload==="object"){delete message.payload.token;}}};
function record(event){
var data=event.data;
var type=(data&&typeof data==="object"&&typeof data.type==="string")?data.type:null;
var allowed=ALLOWED.indexOf(event.origin)!==-1;
// Anything shaped like our envelope is recorded even from a rejected origin:
// "a wrong origin tried" is a diagnostic result, not noise to hide. Everything
// else from a rejected origin is dev-server and extension chatter, and is counted only.
if(!type||(!allowed&&type!==AUTH)){bridge.ignoredCount++;return;}
// A shallow copy, not the event's own object. Two reasons: event.data belongs to
// the browser and scrubbing it later would be mutating something that is not
// ours, and holding a reference keeps the whole delivered payload alive for as
// long as the buffer does.
var copy=data;
if(data&&typeof data==="object"){copy={};for(var k in data){if(Object.prototype.hasOwnProperty.call(data,k)){copy[k]=data[k];}}}
var message={origin:event.origin,type:type,allowed:allowed,receivedAt:Date.now(),buffered:false,payload:copy};
if(bridge.subscriber){try{bridge.subscriber(message);}catch(e){}return;}
if(bridge.buffer.length<LIMIT){bridge.buffer.push(message);}else{bridge.ignoredCount++;}}
window.addEventListener("message",record,false);
window[G]=bridge;
try{
var opener=window.opener;
bridge.readySignal.hasOpener=!!opener;
bridge.readySignal.at=Date.now();
if(opener){for(var j=0;j<ALLOWED.length;j++){
try{opener.postMessage({type:READY,url:location.origin+location.pathname},ALLOWED[j]);bridge.readySignal.postedTo.push(ALLOWED[j]);}
catch(e){bridge.readySignal.failedFor.push(ALLOWED[j]);}}}
}catch(e){}
})();`;
}
