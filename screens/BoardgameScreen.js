/**
 * BoardGameScreen.js — Fixed
 * Fixes applied to user's current code:
 * 1. White screen: shuffle helpers moved to module-level (no stale closure in onSnapshot)
 * 2. Randomization: shuffledDeck state + per-cycle reshuffle via buildFreshDeck
 * 3. Stun: separate activeStunRef (not shared with me.stunned block), removed dual detection
 * 4. 1v1 priority: pendingStun queued during duel, applied in dismissDuel
 * 5. Deflector: removeFromInventory(item.id) actually called
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, ActivityIndicator, SafeAreaView, Modal, Image, useWindowDimensions, Pressable, Platform,
} from "react-native";
import { db, auth } from "../firebaseConfig";
import { doc, onSnapshot, updateDoc, runTransaction, getDoc, deleteField } from "firebase/firestore";

// Dynamic BOARD_COLS: base 10, increases for very large boards
function calcBoardCols(boardEnd) {
  if (boardEnd <= 80) return 10;
  if (boardEnd <= 120) return 12;
  return 14;
}
const BOARD_COLS = 10;

// ── Module-level shuffle helpers — defined here so onSnapshot closure is NEVER stale ──
function fyShuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function shuffleQuestionAnswers(qs) {
  return qs.map(q => {
    if (q.type === 'trueFalse' || !Array.isArray(q.answers) || q.answers.length < 2) return q;
    const n = q.answers.length;
    const perm = fyShuffleArr(Array.from({ length: n }, (_, k) => k));
    return {
      ...q,
      answers:        perm.map(k => q.answers[k]),
      correctAnswers: perm.map(k => q.correctAnswers[k]),
    };
  });
}
// randQ / randA flags come from session.settings — if both false, returns questions unchanged
function buildFreshDeck(rawQuestions, randQ = true, randA = true) {
  let qs = randQ ? fyShuffleArr(rawQuestions) : [...rawQuestions];
  if (randA) qs = shuffleQuestionAnswers(qs);
  return qs;
}

const SPACE_CFG = {
  normal:  { bg:"#3dd68c", border:"#27ae60", label:"" },
  lava:    { bg:"#b91c1c", border:"#f87171", label:"L" },
  cannon:  { bg:"#0369a1", border:"#38bdf8", label:"C" },
  trap:    { bg:"#ea580c", border:"#fb923c", label:"T" },
  mystery: { bg:"#9333ea", border:"#a855f7", label:"?" },
};

const MYSTERY_DEFS = {
  pushback:   { emoji:"", title:"Push Back",     desc:"Push a player 3 spaces backward.",                color:"#e74c3c", needsTarget:true,  inventoryType:null },
  duel:       { emoji:"",  title:"1v1 a Player",  desc:"Challenge a player to a 3-question quiz duel.",   color:"#3498db", needsTarget:true,  inventoryType:null },
  stun:       { emoji:"", title:"Stun",           desc:"A player must answer 3 in a row to recover.",     color:"#e67e22", needsTarget:true,  inventoryType:null },
  immunity:   { emoji:"",  title:"Immunity",      desc:"Protected from effects & bad tiles for 2 landings or 45 s.", color:"#2ecc71", needsTarget:false, inventoryType:null },
  doubleroll: { emoji:"🎲", title:"Double Roll",    desc:"Your next 2 rolls each sum 2 dice.",               color:"#9b59b6", needsTarget:false, inventoryType:null },
  deflector:  { emoji:"", title:"Deflector",      desc:"Saved to inventory! Reflects next incoming effect back for 30 s.", color:"#00bcd4", needsTarget:false, inventoryType:"deflector" },
  badluck:    { emoji:"🌑", title:"Bad Luck Aura",  desc:"A player loses 30% Luck for 45 seconds.",         color:"#7f8c8d", needsTarget:true,  inventoryType:null },
};
const MYSTERY_KEYS = Object.keys(MYSTERY_DEFS);

// Solo mode: only helpful effects, no player-targeting
const SOLO_MYSTERY_DEFS = {
  immunity:   MYSTERY_DEFS.immunity,
  doubleroll: MYSTERY_DEFS.doubleroll,
};
const SOLO_MYSTERY_KEYS = Object.keys(SOLO_MYSTERY_DEFS);

const INVENTORY_DEFS = {
  mystery_box: { emoji:"", label:"Mystery Box", desc:"Open for a random effect" },
  deflector:   { emoji:"", label:"Deflector",   desc:"Reflect next effect (30 s)" },
};

const DICE_EMOJI = ["⚀","⚁","⚂","⚃","⚄","⚅"];
const getDiceFace = (n) => DICE_EMOJI[Math.min(5, Math.max(0, n - 1))] || "?";
const formatTime  = (s) => s == null ? "--:--" : `${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`;

function getCorrectText(q) {
  if (!q) return "";
  if (q.type === "multiSelect") {
    const corrects = (q.correctAnswers||[]).map((v,i) => v ? q.answers?.[i] : null).filter(Boolean);
    return corrects.length ? corrects.join(", ") : "";
  }
  if (q.type === "multipleChoice") {
    const i = (q.correctAnswers||[]).indexOf(true);
    return i >= 0 ? (q.answers?.[i] || "") : "";
  }
  return q.correctAnswers?.[0] === true ? "True" : "False";
}

function Pawn({ color, size = 20 }) {
  const c = color || "#888";
  const s = size;
  const dark = "rgba(0,0,0,0.6)";
  return (
    <View style={{ width: s, height: s * 1.1, alignItems: "center", justifyContent: "flex-end" }}>
      {/* Head — simple circle */}
      <View style={{ width: s * 0.46, height: s * 0.46, borderRadius: s * 0.23,
          backgroundColor: c, borderWidth: 1.5, borderColor: dark }} />
      {/* Body — tapered trapezoid shape */}
      <View style={{ width: s * 0.68, height: s * 0.44,
          borderTopLeftRadius: s * 0.08, borderTopRightRadius: s * 0.08,
          borderBottomLeftRadius: s * 0.18, borderBottomRightRadius: s * 0.18,
          backgroundColor: c, borderWidth: 1.5, borderColor: dark,
          marginTop: s * 0.04 }} />
    </View>
  );
}


// ── Snake head — bird's eye, round, facing LEFT ────────────────────────────
function SnakeHead({ size = 40, facesLeft = true }) {
  const s = size;
  return (
    <View style={{ width: s, height: s, overflow: 'visible', alignItems: 'center', justifyContent: 'center' }}>
      {/* Main round head */}
      <View style={{
        width: s * 0.92, height: s * 0.92, borderRadius: s * 0.46,
        backgroundColor: '#2ecc71',
        borderWidth: 2.5, borderColor: '#1a8a3a',
        alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOffset: {width:0,height:2}, shadowOpacity:0.4, shadowRadius:4,
      }}>
        {/* Top eye */}
        <View style={{
          position: 'absolute', top: s * 0.1, [facesLeft?'left':'right']: s * 0.18,
          width: s * 0.24, height: s * 0.24, borderRadius: s * 0.12,
          backgroundColor: '#fff', borderWidth: 2, borderColor: '#111',
        }}>
          <View style={{
            position: 'absolute', top: s*0.04, left: s*0.04,
            width: s*0.13, height: s*0.13, borderRadius: s*0.065,
            backgroundColor: '#111',
          }}/>
          <View style={{
            position: 'absolute', top: s*0.02, right: s*0.02,
            width: s*0.06, height: s*0.06, borderRadius: s*0.03,
            backgroundColor: 'rgba(255,255,255,0.8)',
          }}/>
        </View>
        {/* Bottom eye */}
        <View style={{
          position: 'absolute', bottom: s * 0.1, [facesLeft?'left':'right']: s * 0.18,
          width: s * 0.24, height: s * 0.24, borderRadius: s * 0.12,
          backgroundColor: '#fff', borderWidth: 2, borderColor: '#111',
        }}>
          <View style={{
            position: 'absolute', top: s*0.04, left: s*0.04,
            width: s*0.13, height: s*0.13, borderRadius: s*0.065,
            backgroundColor: '#111',
          }}/>
          <View style={{
            position: 'absolute', top: s*0.02, right: s*0.02,
            width: s*0.06, height: s*0.06, borderRadius: s*0.03,
            backgroundColor: 'rgba(255,255,255,0.8)',
          }}/>
        </View>
        {/* Nostril dots near left edge */}
        <View style={{ position:'absolute', top:s*0.24, [facesLeft?'left':'right']:s*0.06, width:s*0.07, height:s*0.07, borderRadius:s*0.035, backgroundColor:'#1a6a2a' }}/>
        <View style={{ position:'absolute', bottom:s*0.24, [facesLeft?'left':'right']:s*0.06, width:s*0.07, height:s*0.07, borderRadius:s*0.035, backgroundColor:'#1a6a2a' }}/>
      </View>
      {/* Tongue — direction matches head facing */}
      <View style={{ position:'absolute', top:s*0.44, [facesLeft?'left':'right']:-s*0.18, width:s*0.22, height:3.5, backgroundColor:'#e74c3c', borderRadius:2 }}/>
      <View style={{ position:'absolute', top:s*0.3, [facesLeft?'left':'right']:-s*0.26, width:3, height:s*0.18, backgroundColor:'#e74c3c', borderRadius:2, transform:[{rotate:facesLeft?'-28deg':'28deg'}] }}/>
      <View style={{ position:'absolute', top:s*0.52, [facesLeft?'left':'right']:-s*0.26, width:3, height:s*0.18, backgroundColor:'#e74c3c', borderRadius:2, transform:[{rotate:facesLeft?'28deg':'-28deg'}] }}/>
    </View>
  );
}


// ── Lava tile ─────────────────────────────────────────────────────────────
function LavaTile({ sz }) {
  const glowOrange = "#ff5500", glowYellow = "#ffbb00";
  return (
    <View style={{ width:sz, height:sz, borderRadius:7, overflow:"hidden", backgroundColor:"#1c0800" }}>
      {[{t:0,l:0,w:0.44,h:0.42,c:"#280c01"},{t:0,l:0.48,w:0.52,h:0.36,c:"#2e0e02"},
        {t:0.45,l:0,w:0.38,h:0.55,c:"#240b01"},{t:0.4,l:0.42,w:0.58,h:0.6,c:"#2a0d02"},
      ].map((r,i)=>(
        <View key={i} style={{ position:"absolute", top:sz*r.t, left:sz*r.l, width:sz*r.w, height:sz*r.h, backgroundColor:r.c }} />
      ))}
      <View style={{ position:"absolute", top:sz*0.41, left:0, right:0, height:sz*0.07, backgroundColor:glowOrange }} />
      <View style={{ position:"absolute", left:sz*0.43, top:0, bottom:0, width:sz*0.07, backgroundColor:glowOrange }} />
      <View style={{ position:"absolute", top:sz*0.35, left:0, right:0, height:sz*0.19, backgroundColor:"rgba(255,80,0,0.18)" }} />
      <View style={{ position:"absolute", top:sz*0.36, left:sz*0.38, width:sz*0.18, height:sz*0.18, borderRadius:sz*0.09, backgroundColor:glowYellow }} />
    </View>
  );
}
// ── Trap tile ─────────────────────────────────────────────────────────────
function TrapTile({ sz }) {
  return (
    <View style={{ width:sz, height:sz, borderRadius:7, overflow:"hidden", backgroundColor:"#2a2520" }}>
      {[{t:0,l:0,w:0.47,h:0.47,c:"#3d3530"},{t:0,l:0.53,w:0.47,h:0.47,c:"#362f28"},
        {t:0.53,l:0,w:0.47,h:0.47,c:"#383028"},{t:0.53,l:0.53,w:0.47,h:0.47,c:"#3a3228"},
      ].map((r,i)=>(
        <View key={i} style={{ position:"absolute", top:sz*r.t, left:sz*r.l, width:sz*r.w, height:sz*r.h, backgroundColor:r.c, borderWidth:0.5, borderColor:"#1a1510" }} />
      ))}
      <View style={{ position:"absolute", top:sz*0.19, left:sz*0.18, width:sz*0.64, height:sz*0.62, borderRadius:sz*0.04, backgroundColor:"#0a0806", borderWidth:2, borderColor:"#111" }}>
        <View style={{ position:"absolute", top:2, left:2, right:2, bottom:2, borderRadius:sz*0.03, backgroundColor:"#050303" }} />
      </View>
      {[0.26,0.40,0.54,0.68].map((l,i)=>(
        <View key={i} style={{ position:"absolute", bottom:sz*0.21, left:sz*l, width:0, height:0,
          borderLeftWidth:sz*0.05, borderRightWidth:sz*0.05, borderBottomWidth:sz*0.22,
          borderLeftColor:"transparent", borderRightColor:"transparent",
          borderBottomColor: i%2===0 ? "#9e9e9e" : "#bdbdbd" }} />
      ))}
    </View>
  );
}
// ── Cannon tile ───────────────────────────────────────────────────────────
function CannonTile({ sz }) {
  return (
    <View style={{ width:sz, height:sz, borderRadius:7, overflow:"hidden", backgroundColor:"#0e1620" }}>
      {[{t:0,l:0,w:0.5,h:0.5,c:"#16202c"},{t:0,l:0.5,w:0.5,h:0.5,c:"#131d28"},
        {t:0.5,l:0,w:0.5,h:0.5,c:"#14202a"},{t:0.5,l:0.5,w:0.5,h:0.5,c:"#16222e"},
      ].map((r,i)=>(
        <View key={i} style={{ position:"absolute", top:sz*r.t, left:sz*r.l, width:sz*r.w, height:sz*r.h, backgroundColor:r.c, borderWidth:0.5, borderColor:"#0a1218" }} />
      ))}
      <View style={{ position:"absolute", top:sz*0.28, left:sz*0.16, width:sz*0.74, height:sz*0.44, borderRadius:sz*0.04, backgroundColor:"#4a3520", borderWidth:1.5, borderColor:"#2c1e10" }} />
      <View style={{ position:"absolute", top:sz*0.34, left:sz*0.06, width:sz*0.64, height:sz*0.26, borderRadius:sz*0.13, backgroundColor:"#546e7a", borderWidth:1.5, borderColor:"#263238" }} />
      <View style={{ position:"absolute", top:sz*0.36, left:sz*0.04, width:sz*0.12, height:sz*0.22, borderRadius:sz*0.11, backgroundColor:"#37474f" }}>
        <View style={{ position:"absolute", top:sz*0.03, left:sz*0.02, width:sz*0.08, height:sz*0.15, borderRadius:sz*0.075, backgroundColor:"#0a1018" }} />
      </View>
      <View style={{ position:"absolute", bottom:sz*0.05, left:sz*0.14, width:sz*0.3, height:sz*0.3, borderRadius:sz*0.15, backgroundColor:"#5d4037", borderWidth:2, borderColor:"#3e2723" }} />
      <View style={{ position:"absolute", bottom:sz*0.05, left:sz*0.56, width:sz*0.3, height:sz*0.3, borderRadius:sz*0.15, backgroundColor:"#5d4037", borderWidth:2, borderColor:"#3e2723" }} />
    </View>
  );
}
// ── Snake tail — simple tapered tail pointing LEFT (tile 0) ─────────────────
function SnakeTail({ size = 40 }) {
  const s = size;
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
      {/* Tail extends from tile's left edge all the way left */}
      <View style={{ position: 'absolute', right: s * 0.35, flexDirection: 'row', alignItems: 'center' }}>
        {/* Curvy tip — wavy S-shape made of overlapping ovals */}
        <View style={{ width: s * 0.12, height: s * 0.1, borderRadius: s * 0.05,
          backgroundColor: '#2ecc71', marginRight: -s * 0.02,
          transform: [{rotate: '15deg'}] }}/>
        <View style={{ width: s * 0.12, height: s * 0.12, borderRadius: s * 0.06,
          backgroundColor: '#27ae60',
          borderTopWidth: 1, borderTopColor: '#5ddb8a',
          borderBottomWidth: 2, borderBottomColor: '#145a32',
          marginRight: -s * 0.02,
          transform: [{rotate: '-10deg'}] }}/>
        {/* Thin neck */}
        <View style={{ width: s * 0.14, height: s * 0.16,
          borderRadius: s * 0.04,
          backgroundColor: '#27ae60',
          borderTopWidth: 1, borderTopColor: '#5ddb8a',
          borderBottomWidth: 2, borderBottomColor: '#145a32',
          marginRight: -s * 0.01 }}/>
        {/* Mid taper */}
        <View style={{ width: s * 0.18, height: s * 0.26,
          borderRadius: s * 0.06,
          backgroundColor: '#2ecc71',
          borderTopWidth: 1.5, borderTopColor: '#5ddb8a',
          borderBottomWidth: 3, borderBottomColor: '#145a32',
          marginRight: -s * 0.02 }}/>
        {/* Wide base connecting to tile */}
        <View style={{ width: s * 0.26, height: s * 0.4,
          borderRadius: s * 0.08,
          backgroundColor: '#27ae60',
          borderTopWidth: 2, borderTopColor: '#5ddb8a',
          borderBottomWidth: 4, borderBottomColor: '#0d5c2a',
          marginRight: -s * 0.03 }}/>
      </View>
    </View>
  );
}

function buildSnakeRows(be, cols) {
  const C = cols || BOARD_COLS;
  const rows = [];
  for (let r = 0; r <= be; r += C) {
    const row = [];
    for (let t = r; t < r + C && t <= be; t++) row.push(t);
    if (Math.floor(r / C) % 2 === 1) row.reverse();
    rows.push(row);
  }
  return rows.reverse();
}

function SnakeBoard({ board, players, myPosition, myPlayerName, myPlayerColor, highlightPos, boardEnd, tileSize }) {
  const sz = tileSize || 40;
  const M  = Math.max(1, Math.round(sz * 0.03)); // tight gap — more connected look
  const R  = sz * 0.42;  // very round
  const tp = sz + M * 2; // tile pitch

  const COLS  = calcBoardCols(boardEnd);
  const rows  = buildSnakeRows(boardEnd, COLS);
  const nRows = rows.length;

  const playersAt = (i) => players.filter(p => (p.position||0) === i);
  const spaceType = (i) => (Array.isArray(board) && board.find(sp => sp?.index === i))?.type || 'normal';
  // Head faces the direction OPPOSITE its body. Body extends from head toward tile (boardEnd-1).
  // Head faces AWAY from the corner connector below it.
  // Corner connector aligns with the path entry into top row, which is on the side
  // where the row below ends. Path direction in top row goes FROM connector AWAY from it.
  // Head is at end of path. Direction snake LAST moved = direction head faces.
  // In a R→L array [end, end-1, ...], end-1 is to the RIGHT visually → snake came from right
  //   → snake last moved LEFT → head faces LEFT
  // In a L→R array [..., end-1, end], end-1 is to the LEFT visually → snake came from left
  //   → snake last moved RIGHT → head faces RIGHT
  // So: head faces LEFT if head is FIRST element of row (R→L row)
  //     head faces RIGHT if head is LAST element of row (L→R row)
  // INVERTED from user feedback — they want head facing toward the open space/away from body's long extent
  // The body actually extends in the corner-direction (downward through corner). So in 2D:
  //   head faces opposite the corner side. Corner is on the side where row-below ends.
  //   Row below = ri=1, rowIndex of below = nRows - 2
  //   belowEndsRight = (nRows - 2) % 2 === 0
  //   If belowEndsRight, corner is on RIGHT below head → head faces LEFT (away)
  //   If !belowEndsRight, corner is on LEFT below head → head faces RIGHT (away)
  const _belowRowIdx_top = nRows - 2;
  const _cornerOnRight   = _belowRowIdx_top >= 0 && _belowRowIdx_top % 2 === 0;
  const headFacesLeft = _cornerOnRight; // head faces away from corner

  // ── Base tile style — uniform dark green, strong 3D bevel ─────────────────
  const base = (isHL, isMe) => ({
    width:sz, height:sz, borderRadius:R,
    backgroundColor: '#27ae60',
    borderTopWidth:2,   borderLeftWidth:2,
    borderBottomWidth:6, borderRightWidth:5,
    borderTopColor:   isHL||isMe ? '#fff' : '#5ddb8a',
    borderLeftColor:  isHL||isMe ? '#fff' : '#5ddb8a',
    borderBottomColor:isHL||isMe ? '#fff' : '#0d5c2a',
    borderRightColor: isHL||isMe ? '#fff' : '#176b33',
    transform:[{scale: isHL ? 1.1 : 1}],
    alignItems:'center', justifyContent:'center',
    position:'relative', overflow:'visible',
  });

  // ── Draw special tile content ─────────────────────────────────────────────
  const tileContent = (i) => {
    const type = spaceType(i);
    if (i === boardEnd) return <SnakeHead size={sz*0.92} facesLeft={headFacesLeft}/>;
    if (i === 0)        return <SnakeTail size={sz*0.92}/>;

    if (type === 'lava') return (
      <View style={{position:'absolute',top:0,left:0,right:0,bottom:0,borderRadius:R,
        backgroundColor:'#991b1b',overflow:'hidden',
        borderTopWidth:2.5,borderTopColor:'#e74c3c',
        borderLeftWidth:2,borderLeftColor:'#c0392b',
        borderBottomWidth:6,borderBottomColor:'#3a0a02',
        borderRightWidth:5,borderRightColor:'#5a1207'}}>
        {/* Lava texture spots */}
        <View style={{position:'absolute',top:sz*0.08,left:sz*0.1,width:sz*0.2,height:sz*0.16,
          borderRadius:sz*0.1,backgroundColor:'#a52a1a',opacity:0.6}}/>
        <View style={{position:'absolute',top:sz*0.55,right:sz*0.08,width:sz*0.18,height:sz*0.14,
          borderRadius:sz*0.08,backgroundColor:'#a52a1a',opacity:0.5}}/>
        {/* Glowing center pool */}
        <View style={{position:'absolute',top:'50%',left:'50%',
          marginLeft:-sz*0.22,marginTop:-sz*0.22,
          width:sz*0.44,height:sz*0.44,borderRadius:sz*0.22,
          backgroundColor:'#ff5722',
          borderTopWidth:2,borderTopColor:'#ffab40',
          borderLeftWidth:1.5,borderLeftColor:'#ff8a65',
          borderBottomWidth:3,borderBottomColor:'#bf360c',
          borderRightWidth:2,borderRightColor:'#dd2c00',
          alignItems:'center',justifyContent:'center'}}>
          {/* Inner hot core */}
          <View style={{width:sz*0.24,height:sz*0.24,borderRadius:sz*0.12,
            backgroundColor:'#ffeb3b',
            borderTopWidth:1,borderTopColor:'#fff59d',
            borderBottomWidth:2,borderBottomColor:'#f57f17',
            alignItems:'center',justifyContent:'center'}}>
            {/* Brightest spot */}
            <View style={{width:sz*0.1,height:sz*0.1,borderRadius:sz*0.05,
              backgroundColor:'#fff',opacity:0.85}}/>
          </View>
        </View>
        {/* Glow ring around center */}
        <View style={{position:'absolute',top:'50%',left:'50%',
          marginLeft:-sz*0.3,marginTop:-sz*0.3,
          width:sz*0.6,height:sz*0.6,borderRadius:sz*0.3,
          borderWidth:1.5,borderColor:'rgba(255,140,0,0.4)'}}/>
        {/* Lava cracks radiating outward */}
        <View style={{position:'absolute',top:sz*0.15,left:sz*0.18,width:sz*0.18,height:1.5,
          backgroundColor:'#ff8c00',transform:[{rotate:'-30deg'}]}}/>
        <View style={{position:'absolute',bottom:sz*0.15,right:sz*0.18,width:sz*0.18,height:1.5,
          backgroundColor:'#ff8c00',transform:[{rotate:'-30deg'}]}}/>
      </View>
    );

    if (type === 'cannon') return (
      <View style={{position:'absolute',top:0,left:0,right:0,bottom:0,
        alignItems:'center',justifyContent:'center'}}>
        {/* Perfect circle shadow */}
        <View style={{position:'absolute',bottom:sz*0.1,
          width:sz*0.28,height:sz*0.28,borderRadius:sz*0.14,
          backgroundColor:'rgba(0,40,120,0.6)',opacity:0.5}}/>

        <View style={{alignItems:'center',justifyContent:'center'}}>
          {/* Outer glow ring */}
          <View style={{position:'absolute',
            width:sz*0.58,height:sz*0.58,borderRadius:sz*0.29,
            backgroundColor:'rgba(56,189,248,0.12)',
            borderWidth:1.5,borderColor:'rgba(56,189,248,0.3)'}}/>
          {/* Mid glow ring */}
          <View style={{position:'absolute',
            width:sz*0.48,height:sz*0.48,borderRadius:sz*0.24,
            backgroundColor:'rgba(14,165,233,0.18)',
            borderWidth:1.5,borderColor:'rgba(125,211,252,0.5)'}}/>

          {/* Main orb */}
          <View style={{width:sz*0.38,height:sz*0.38,borderRadius:sz*0.19,
            backgroundColor:'#0369a1',
            borderTopWidth:3,borderTopColor:'#7dd3fc',
            borderLeftWidth:2.5,borderLeftColor:'#38bdf8',
            borderBottomWidth:4,borderBottomColor:'#0c4a6e',
            borderRightWidth:2.5,borderRightColor:'#0284c7',
            alignItems:'center',justifyContent:'center'}}>
            {/* Inner glowing core */}
            <View style={{width:sz*0.22,height:sz*0.22,borderRadius:sz*0.11,
              backgroundColor:'#38bdf8',
              borderTopWidth:2,borderTopColor:'#e0f2fe',
              borderBottomWidth:2,borderBottomColor:'#0369a1',
              alignItems:'center',justifyContent:'center'}}>
              {/* Brightest center point */}
              <View style={{width:sz*0.1,height:sz*0.1,borderRadius:sz*0.05,
                backgroundColor:'#e0f2fe',opacity:0.9}}/>
            </View>
            {/* Highlight arc top-left */}
            <View style={{position:'absolute',top:sz*0.04,left:sz*0.04,
              width:sz*0.1,height:sz*0.06,borderRadius:sz*0.04,
              backgroundColor:'rgba(224,242,254,0.6)',
              transform:[{rotate:'-35deg'}]}}/>
          </View>

          {/* Energy sparks radiating outward — 4 directions */}
          {[
            {top:-sz*0.06,left:sz*0.16,rotate:'0deg'},
            {top:sz*0.16,right:-sz*0.06,rotate:'90deg'},
            {bottom:-sz*0.06,left:sz*0.16,rotate:'180deg'},
            {top:sz*0.16,left:-sz*0.06,rotate:'270deg'},
          ].map((pos,k)=>(
            <View key={k} style={{position:'absolute',...pos,
              width:sz*0.07,height:sz*0.03,
              borderRadius:sz*0.015,
              backgroundColor:'#7dd3fc',opacity:0.9}}/>
          ))}
          {/* Diagonal sparks */}
          {[
            {top:sz*0.02,left:sz*0.02,rotate:'-45deg'},
            {top:sz*0.02,right:sz*0.02,rotate:'45deg'},
            {bottom:sz*0.02,left:sz*0.02,rotate:'45deg'},
            {bottom:sz*0.02,right:sz*0.02,rotate:'-45deg'},
          ].map((pos,k)=>(
            <View key={k} style={{position:'absolute',...pos,
              width:sz*0.05,height:sz*0.02,
              borderRadius:sz*0.01,
              backgroundColor:'#bae6fd',opacity:0.7}}/>
          ))}
        </View>
      </View>
    );

    if (type === 'trap') return (
      <View style={{position:'absolute',top:0,left:0,right:0,bottom:0,
        alignItems:'center',justifyContent:'center'}}>
        {/* Shadow — ellipse fitting the circle beneath */}
        <View style={{position:'absolute',bottom:sz*0.14,
          width:sz*0.38,height:sz*0.12,
          borderRadius:sz*0.06,
          backgroundColor:'rgba(154,52,18,0.65)',opacity:0.6}}/>

        <View style={{alignItems:'center',justifyContent:'center'}}>
          {/* Dark pulsing outer ring */}
          <View style={{position:'absolute',
            width:sz*0.64,height:sz*0.64,borderRadius:sz*0.32,
            backgroundColor:'rgba(234,88,12,0.1)',
            borderWidth:2,borderColor:'rgba(251,146,60,0.4)'}}/>
          {/* Jagged energy ring */}
          <View style={{position:'absolute',
            width:sz*0.52,height:sz*0.52,borderRadius:sz*0.26,
            backgroundColor:'transparent',
            borderWidth:2.5,borderColor:'#ea580c'}}/>
          {/* Inner crackling ring */}
          <View style={{position:'absolute',
            width:sz*0.4,height:sz*0.4,borderRadius:sz*0.2,
            backgroundColor:'rgba(234,88,12,0.12)',
            borderWidth:1.5,borderColor:'rgba(253,186,116,0.5)'}}/>

          {/* Dark sinister core */}
          <View style={{width:sz*0.28,height:sz*0.28,borderRadius:sz*0.14,
            backgroundColor:'#9a3412',
            borderTopWidth:2,borderTopColor:'#fb923c',
            borderLeftWidth:2,borderLeftColor:'#ea580c',
            borderBottomWidth:4,borderBottomColor:'#431407',
            borderRightWidth:3,borderRightColor:'#7c2d12',
            alignItems:'center',justifyContent:'center'}}>
            {/* Glowing evil center */}
            <View style={{width:sz*0.14,height:sz*0.14,borderRadius:sz*0.07,
              backgroundColor:'#f97316',
              borderTopWidth:1.5,borderTopColor:'#fed7aa',
              borderBottomWidth:2,borderBottomColor:'#7c2d12',
              alignItems:'center',justifyContent:'center'}}>
              <View style={{width:sz*0.06,height:sz*0.06,borderRadius:sz*0.03,
                backgroundColor:'#fef9c3',opacity:0.95}}/>
            </View>
          </View>

          {/* SKULL-like crossbones / rune marks — 4 sharp daggers pointing inward */}
          {[0,90,180,270].map((deg,k)=>(
            <View key={k} style={{position:'absolute',
              width:sz*0.07,height:sz*0.07,
              alignItems:'center',justifyContent:'center',
              transform:[
                {rotate: deg+'deg'},
                {translateY: -sz*0.24}
              ]}}>
              {/* Dagger blade */}
              <View style={{width:0,height:0,
                borderLeftWidth:sz*0.035,borderRightWidth:sz*0.035,
                borderBottomWidth:sz*0.065,
                borderLeftColor:'transparent',borderRightColor:'transparent',
                borderBottomColor:'#fb923c'}}/>
              {/* Dagger base */}
              <View style={{width:sz*0.05,height:sz*0.02,
                backgroundColor:'#ef4444',marginTop:-sz*0.005,
                borderRadius:sz*0.01}}/>
            </View>
          ))}

          {/* Small blood-red dots at 45° positions */}
          {[45,135,225,315].map((deg,k)=>(
            <View key={k} style={{position:'absolute',
              width:sz*0.04,height:sz*0.04,borderRadius:sz*0.02,
              backgroundColor:'#f97316',opacity:0.9,
              transform:[
                {rotate: deg+'deg'},
                {translateX: sz*0.22}
              ]}}/>
          ))}
        </View>
      </View>
    );

    if (type === 'mystery') return (
      // Mystery box 25% bigger, floats higher above tile
      <View style={{position:'absolute', top:-sz*0.36, left:0, right:0,
        alignItems:'center', zIndex:10}}>
        {/* Flat ellipse shadow on tile surface */}
        <View style={{position:'absolute', bottom:-sz*0.22,
          width:sz*0.44, height:sz*0.09,
          borderRadius:sz*0.045,
          backgroundColor:'rgba(0,0,0,0.55)',
          opacity:0.55}}/>

        {/* 3D CUBE — 25% bigger */}
        <View style={{width:sz*0.58, height:sz*0.55, position:'relative'}}>

          {/* TOP FACE — horizontal diamond */}
          <View style={{position:'absolute', top:0, left:sz*0.05,
            width:sz*0.48, height:sz*0.225}}>
            <View style={{position:'absolute', top:0, left:0,
              width:0, height:0,
              borderRightWidth:sz*0.24, borderTopWidth:sz*0.1125,
              borderRightColor:'#e9d5ff', borderTopColor:'transparent'}}/>
            <View style={{position:'absolute', bottom:0, left:0,
              width:0, height:0,
              borderRightWidth:sz*0.24, borderBottomWidth:sz*0.1125,
              borderRightColor:'#ddd6fe', borderBottomColor:'transparent'}}/>
            <View style={{position:'absolute', top:0, right:0,
              width:0, height:0,
              borderLeftWidth:sz*0.24, borderTopWidth:sz*0.1125,
              borderLeftColor:'#c4b5fd', borderTopColor:'transparent'}}/>
            <View style={{position:'absolute', bottom:0, right:0,
              width:0, height:0,
              borderLeftWidth:sz*0.24, borderBottomWidth:sz*0.1125,
              borderLeftColor:'#a78bfa', borderBottomColor:'transparent'}}/>
            <View style={{position:'absolute', top:sz*0.05, left:sz*0.08,
              width:sz*0.04, height:sz*0.04, borderRadius:sz*0.02,
              backgroundColor:'rgba(255,255,255,0.9)'}}/>
          </View>

          {/* LEFT FACE */}
          <View style={{position:'absolute', top:sz*0.19, left:sz*0.05,
            width:sz*0.24, height:sz*0.33,
            backgroundColor:'#a78bfa',
            transform:[{skewY:'30deg'}],
            borderTopWidth:1, borderTopColor:'#d8b4fe',
            borderLeftWidth:2, borderLeftColor:'#9333ea',
            borderBottomWidth:3, borderBottomColor:'#5b21b6',
            overflow:'hidden'}}>
            <View style={{position:'absolute', top:sz*0.05, left:sz*0.05,
              width:sz*0.025, height:sz*0.025, borderRadius:sz*0.012,
              backgroundColor:'rgba(255,182,193,0.7)'}}/>
            <View style={{position:'absolute', top:sz*0.15, left:sz*0.11,
              width:sz*0.022, height:sz*0.022, borderRadius:sz*0.011,
              backgroundColor:'rgba(135,206,250,0.7)'}}/>
            <View style={{position:'absolute', bottom:sz*0.05, left:sz*0.06,
              width:sz*0.028, height:sz*0.028, borderRadius:sz*0.014,
              backgroundColor:'rgba(255,255,255,0.5)'}}/>
          </View>

          {/* RIGHT FACE */}
          <View style={{position:'absolute', top:sz*0.19, right:sz*0.05,
            width:sz*0.24, height:sz*0.33,
            backgroundColor:'#9333ea',
            transform:[{skewY:'-30deg'}],
            borderTopWidth:1, borderTopColor:'#c4b5fd',
            borderRightWidth:2, borderRightColor:'#5b21b6',
            borderBottomWidth:3, borderBottomColor:'#3b0764',
            alignItems:'center', justifyContent:'center',
            overflow:'hidden'}}>
            <Text style={{transform:[{skewY:'30deg'}],
              color:'#fff', fontSize:sz*0.2, fontWeight:'900',
              textShadowColor:'rgba(40,20,100,0.9)',
              textShadowOffset:{width:1,height:1}, textShadowRadius:2}}>?</Text>
            <View style={{position:'absolute', top:sz*0.05, right:sz*0.05,
              width:sz*0.025, height:sz*0.025, borderRadius:sz*0.012,
              backgroundColor:'rgba(221,160,221,0.7)'}}/>
            <View style={{position:'absolute', bottom:sz*0.06, right:sz*0.08,
              width:sz*0.028, height:sz*0.028, borderRadius:sz*0.014,
              backgroundColor:'rgba(173,216,230,0.6)'}}/>
          </View>

          {/* Center edge line */}
          <View style={{position:'absolute', top:sz*0.19,
            width:1.5, height:sz*0.3,
            backgroundColor:'rgba(60,30,100,0.5)'}}/>
        </View>
      </View>
    );

    // Normal tile: just number
    return <Text style={{fontSize:sz*0.27,color:'rgba(0,0,0,0.32)',fontWeight:'700'}}>{i}</Text>;
  };

  const tileView = (i) => {
    const here = playersAt(i);
    const isMe = i === myPosition;
    const isHL = i === highlightPos;
    const type = spaceType(i);
    const isLava = type === 'lava';

    return (
      <View key={i} style={base(isHL, isMe)}>
        {tileContent(i)}
        {here.length > 0 && (
          <>
            {/* Red arrow above tile if I am here — zIndex 20 to be ABOVE mystery box */}
            {isMe && (
              <View style={{position:'absolute',top:-sz*0.45,left:0,right:0,alignItems:'center',zIndex:20}}>
                <View style={{width:0,height:0,
                  borderLeftWidth:sz*0.18,borderRightWidth:sz*0.18,borderTopWidth:sz*0.22,
                  borderLeftColor:'transparent',borderRightColor:'transparent',
                  borderTopColor:'#ef4444'}}/>
                <View style={{width:0,height:0,marginTop:-sz*0.22,
                  borderLeftWidth:sz*0.13,borderRightWidth:sz*0.13,borderTopWidth:sz*0.16,
                  borderLeftColor:'transparent',borderRightColor:'transparent',
                  borderTopColor:'#fca5a5'}}/>
              </View>
            )}
            <View style={{position:'absolute',bottom:2,left:0,right:0,
              flexDirection:'row',flexWrap:'wrap',justifyContent:'center',alignItems:'flex-end'}}>
              {here.map((p,pi) => p.name===myPlayerName
                ? <Pawn key={pi} color={p.color||myPlayerColor||'#3dd68c'} size={sz*0.36}/>
                : <View key={pi} style={{width:sz*0.2,height:sz*0.2,borderRadius:sz*0.1,
                    backgroundColor:p.color||'#888',borderWidth:1,borderColor:'rgba(0,0,0,0.4)'}}/>
              )}
            </View>
          </>
        )}
      </View>
    );
  };

  // Corner tile — same green bevel
  const cornerTile = () => (
    <View style={{width:sz,height:sz,borderRadius:R,
      backgroundColor:'#27ae60',
      borderTopWidth:2,borderLeftWidth:2,borderBottomWidth:6,borderRightWidth:5,
      borderTopColor:'#5ddb8a',borderLeftColor:'#5ddb8a',
      borderBottomColor:'#0d5c2a',borderRightColor:'#176b33'}}/>
  );

  // ── KEY FIX: all rows use paddingLeft=tp so tiles sit in cols 1..(BOARD_COLS)
  const rowW = (COLS + 2) * tp;

  return (
    <View style={{alignSelf:'center'}}>
      {rows.map((row, ri) => {
        // rowIndex: 0 = bottom row (contains tile 0). Increases going UP.
        // Bottom row goes L→R, alternates. R→L rows already have array reversed.
        const rowIndex  = nRows - 1 - ri;
        const isLast    = ri === nRows - 1;     // ri = nRows-1 means bottom row visually
        // The corner sits BELOW each row (between it and the row VISUALLY BELOW)
        // The path goes UP from a row to the row above through this corner
        // L→R rows (rowIndex even): exit is RIGHT side, so corner above is on RIGHT
        // R→L rows (rowIndex odd): exit is LEFT side, so corner above is on LEFT
        // BUT ri=0 is TOP row visually, so ri-1 doesn't exist; corner above ri=0 is below the head
        // Actually corner connector is rendered AFTER each row except the bottom (last visually)
        // Connector connects this row to the row ri+1 (which is visually below this one)
        // Path comes UP from row below. So this connector is the EXIT of row ri+1 (the one below).
        // Row ri+1 has rowIndex = nRows-1-(ri+1) = nRows-2-ri
        const belowRowIndex = nRows - 2 - ri;
        const belowEndsRight = belowRowIndex % 2 === 0;

        // ALL rows occupy the SAME horizontal span: cols 1 through BOARD_COLS.
        // All use paddingLeft = tp.
        // For partial top row (head's row), tiles get pushed to RIGHT side if R→L, LEFT if L→R
        const isShortRow = row.length < BOARD_COLS;
        const goesRight  = rowIndex % 2 === 0;
        // For short row: align tiles to the side where the path enters
        // L→R short row: enters from left → align flex-start
        // R→L short row: enters from right → align flex-end
        // Wait: short row = top row = LAST row in path = where head ends
        // Path enters this row from below (corner from row below)
        // Then goes through the row to the head
        // L→R row: enters at left side (from below-left corner), so tiles fill from LEFT
        // R→L row: enters at right side (from below-right corner), so tiles fill from RIGHT
        // R→L row reversed in array: array starts with HIGHEST tile (head if last)
        //   But R→L means head is at LEFT visually, so we want array[0]=head on LEFT
        //   So R→L row tiles render flex-start with paddingLeft=tp gives head at col 1
        //   But path enters R→L row from RIGHT (below-right corner)
        //   That means tile 30 (path entry) should be on the RIGHT of the row
        //   With reversed array [39,38,...,30], rendering flex-start puts 39 at col 1, 30 at col row.length
        //   We want 30 (entry) at col BOARD_COLS, 39 (head/exit) at col BOARD_COLS-row.length+1
        //   So R→L short rows: align with paddingRight=tp, justifyContent flex-end
        //   Then 30 ends at col BOARD_COLS, 39 at col BOARD_COLS-row.length+1
        const alignToRight = !goesRight; // R→L rows align to right edge

        return (
          <View key={ri} style={{width:rowW}}>
            {/* Tile row */}
            <View style={{flexDirection:'row', width:rowW,
              paddingLeft:  alignToRight ? 0 : tp,
              paddingRight: alignToRight ? tp : 0,
              justifyContent: alignToRight ? 'flex-end' : 'flex-start'}}>
              {row.map(i => (
                <View key={i} style={{margin:M}}>
                  {tileView(i)}
                </View>
              ))}
            </View>
            {/* Corner BELOW this row connecting to row below.
                belowEndsRight tells which side the row below exits = which side this corner sits */}
            {!isLast && (
              <View style={{flexDirection:'row', width:rowW,
                paddingLeft:  belowEndsRight ? 0 : tp,
                paddingRight: belowEndsRight ? tp : 0,
                justifyContent: belowEndsRight ? 'flex-end' : 'flex-start'}}>
                <View style={{margin:M}}>
                  {cornerTile()}
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}


function CloseBtn({ onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={S.closeBtn} hitSlop={{top:10,bottom:10,left:10,right:10}}>
      <Text style={S.closeBtnTxt}>✕</Text>
    </TouchableOpacity>
  );
}

function Legend() {
  return (
    <View style={S.legend}>
      {Object.entries(SPACE_CFG).map(([t, cfg]) => (
        <View key={t} style={S.legendItem}>
          <View style={[S.legendSwatch, {
            backgroundColor:cfg.bg, borderColor:cfg.border,
            borderTopWidth:1.5, borderLeftWidth:1.5,
            borderBottomWidth:3, borderRightWidth:3,
            borderTopColor:'rgba(255,255,255,0.22)', borderLeftColor:'rgba(255,255,255,0.22)',
            borderBottomColor:'rgba(0,0,0,0.5)', borderRightColor:'rgba(0,0,0,0.4)',
          }]}/>
          <Text style={[S.legendTxt, {color:cfg.border}]}>{t.charAt(0).toUpperCase()+t.slice(1)}</Text>
        </View>
      ))}
    </View>
  );
}

function DiceFace({ value, style }) {
  return <Text style={style}>{value ? getDiceFace(Math.min(6, value)) : "?"}</Text>;
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function BoardGameScreen({ route, navigation }) {
  // Guard: on web hard-refresh route.params is lost — send back to join screen
  if (!route?.params?.sessionId) {
    // Use a simple effect-free redirect since hooks haven't run yet is not possible,
    // so we render null and navigate in a useEffect below
  }
  const { sessionId, playerName, playerColor="#00c781", playerUid, isHost, hostIsPlaying, gameId, isSolo=false } = route?.params || {};

  // Dynamic tile sizes — recalculate when window resizes (tab minimize/restore)
  const { width: winW, height: winH } = useWindowDimensions();
  const tileByW    = Math.floor((winW - 32) / 17); // placeholder, recalculated after session loads
  const BASE_TILE  = Math.min(64, Math.max(28, tileByW));
  const HOST_TILE = Math.min(96, Math.max(48, Math.floor((winW * 0.65 - 32) / BOARD_COLS)));
  // Responsive scale: 1.0 on a comfortable 480×800 window, scales down linearly for smaller
  const rs = Math.min(1, Math.max(0.55, winH / 800, winW / 480));
  const isMobile = winW < 500;

  const [session,  setSession]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [myState,  setMyState]  = useState(null);
  const [viewMode, setViewMode] = useState("questions");

  // ── Questions: raw list + shuffled deck, rebuilt each cycle ──────────────
  const [questions,    setQuestions]    = useState(null); // raw from Firestore, never changes
  const [shuffledDeck, setShuffledDeck] = useState(null); // randomised view, rebuilt per cycle
  const questionsSetRef = useRef(false);
  const [qIdx, setQIdx] = useState(0);

  const qList    = questions || [];
  const cycleIdx = qList.length > 0 ? qIdx % qList.length : 0;
  // curQ: null until first deck is ready — shows spinner, never crashes
  const curQ = (shuffledDeck && shuffledDeck.length > 0) ? (shuffledDeck[cycleIdx] ?? null) : null;

  const [selAns, setSelAns] = useState(null);
  // Reset answer state whenever question index changes
  useEffect(() => { setSelAns(null); setAnsFB(null); setMultiSelAnswers([]); }, [qIdx]);
  const [multiSelAnswers, setMultiSelAnswers] = useState([]);
  const [ansFB,  setAnsFB]  = useState(null);

  // Progress
  const [cc,     setCc]     = useState(0);
  const [streak, setStreak] = useState(0);
  const [luck,   setLuck]   = useState(0);
  const [total,  setTotal]  = useState(0);
  const ROLL_AT = 3;

  // Phase
  const [phase,        setPhase]        = useState("questions");
  const phaseRef = useRef("questions");
  const setPhaseSync = useCallback((next) => {
    const val = typeof next === "function" ? next(phaseRef.current) : next;
    phaseRef.current = val;
    setPhase(val);
  }, []);
  const [diceValue,    setDiceValue]    = useState(null);
  const [diceRolling,  setDiceRolling]  = useState(false);
  const [highlightPos, setHighlightPos] = useState(null);
  const diceAnim = useRef(new Animated.Value(0)).current;

  const [srType,    setSrType]    = useState(null);
  const [srValue,   setSrValue]   = useState(null);
  const [srRolling, setSrRolling] = useState(false);
  const srAnim = useRef(new Animated.Value(0)).current;
  const srLandingPos = useRef(null); // exact position landed on — avoids Firestore snapshot race

  const [trapEvent,      setTrapEvent]      = useState(null);
  const [trapTimer,      setTrapTimer]      = useState(10);
  const [trapAnswered,   setTrapAnswered]   = useState(false);
  const [trapMultiSel,   setTrapMultiSel]   = useState([]); // for multiSelect trap questions
  const [trapMultiDone,  setTrapMultiDone]  = useState(false);
  const trapRef = useRef(null);

  const [mBoxOpen,    setMBoxOpen]    = useState(false);
  const [mBoxStep,    setMBoxStep]    = useState("roll");
  const [mBoxKey,     setMBoxKey]     = useState(null);
  const [mBoxDef,     setMBoxDef]     = useState(null);
  const [mBoxRolling, setMBoxRolling] = useState(false);
  const savedPhaseRef = useRef(null);
  const mBoxInventoryItemId = useRef(null);
  const mBoxAnim = useRef(new Animated.Value(0)).current;

  const [inventory,   setInventory]   = useState([]);
  const [invFullItem, setInvFullItem] = useState(null);
  const [itemToast,   setItemToast]   = useState(null);
  const toastAnim = useRef(new Animated.Value(0)).current;

  const [roll1Notif, setRoll1Notif] = useState(false);

  const [doubleRollsLeft, setDoubleRollsLeft] = useState(0);
  const [immunityLeft,    setImmunityLeft]    = useState(0);
  const [immunitySecsLeft,setImmunitySecsLeft]= useState(0);
  const immunityTimerRef  = useRef(null);
  const immunitySecsRef   = useRef(null);
  const [deflectorActive, setDeflectorActive] = useState(false);
  const [deflectorSecsLeft,setDeflectorSecsLeft]=useState(0);
  const deflectorTimerRef = useRef(null);
  const deflectorSecsRef  = useRef(null);

  // ── Stun — uses its OWN ref, never shared with any other detection ────────
  const [isStunned,    setIsStunned]    = useState(false);
  const [stunBy,       setStunBy]       = useState("");
  const [stunRecovery, setStunRecovery] = useState(0);
  const [stunQIdx,     setStunQIdx]     = useState(0);
  const [stunSelAns,   setStunSelAns]   = useState(null);
  const activeStunRef = useRef(false); // ONLY tracks activeStuns — not shared with me.stunned
  // Pending stun: queued while duel is active, applied in dismissDuel
  const [pendingStun, setPendingStun] = useState(null);

  const [notif,           setNotif]           = useState("");
  const [showNotif,       setShowNotif]        = useState(false);
  const [interruptedPhase,setInterruptedPhase] = useState(null);
  const lastNotifId = useRef(0);

  const [duelCountdown, setDuelCountdown] = useState(null);
  const duelCountdownRef = useRef(null);
  const duelSeenRef      = useRef(false);

  const [duelAnswered, setDuelAnswered] = useState(false);
  const [duelView,     setDuelView]     = useState("active");
  const lastDuelRound  = useRef(-1);

  const [gameLeft,  setGameLeft]  = useState(null);
  const [qTimeLeft, setQTimeLeft] = useState(null);
  const gameTimerRef = useRef(null);
  const qTimerRef    = useRef(null);
  const timerBar     = useRef(new Animated.Value(1)).current;

  const flashOpacity = useRef(new Animated.Value(0)).current;
  const [flashData,  setFlashData]  = useState(null);
  const [zoomImage,  setZoomImage]  = useState(null);
  const [gameOverDone, setGameOverDone] = useState(false);
  const [showLeave,    setShowLeave]    = useState(false);
  const boardRef   = useRef(null);
  const sessionRef = useRef(null);
  const myStateRef = useRef(null);

  // Stun multiSelect state
  const [stunMultiSel,       setStunMultiSel]       = useState([]);
  const [stunMultiSubmitted, setStunMultiSubmitted] = useState(false);
  // MultiSelect state for duel questions
  const [duelMultiSel,       setDuelMultiSel]       = useState([]);
  const [duelMultiSubmitted, setDuelMultiSubmitted] = useState(false);

  // ── Redirect on web hard-refresh (route.params lost) ─────────────────────
  useEffect(() => {
    if (!sessionId) {
      navigation.reset({ index: 0, routes: [{ name: "JoinGameScreen" }] });
    }
  }, []); // eslint-disable-line

  // ── Session listener ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    return onSnapshot(doc(db, "gameSessions", sessionId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      sessionRef.current = data;

      // Load questions ONCE — buildFreshDeck uses module-level functions (never stale)
      if (!questionsSetRef.current && data.questions?.length) {
        questionsSetRef.current = true;
        const rawQs = data.questions;
        const randQ = data.settings?.randomizeQuestions !== false; // default true
        const randA = data.settings?.randomizeAnswers   !== false;
        setQuestions(rawQs);
        setShuffledDeck(buildFreshDeck(rawQs, randQ, randA));
      }

      const me = (data.players||[]).find(p => (playerUid && p.uid===playerUid) || p.name===playerName);
      if (me) {
        myStateRef.current = me;
        setMyState(me);
        if (me.notification?.id > lastNotifId.current) {
          lastNotifId.current = me.notification.id;
          const txt = me.notification.text || "";
          setNotif(txt);
          setShowNotif(true);
          const cur = phaseRef.current;
          if (cur !== "questions" && cur !== "duel") setInterruptedPhase(cur);
          // Duel invites auto-dismiss after 1.5 s — the countdown will show behind
          if (txt.includes("1v1") || txt.includes("challenged")) {
            setTimeout(() => setShowNotif(false), 1500);
          }
        }
      }

      setSession(data);
      setLoading(false);

      if (!isHost || hostIsPlaying) {
        if (data.status === "abandoned") return;
        if ((data.kickedPlayers||[]).includes(playerName)) return;
      }

      // ── Stun detection — uses activeStunRef exclusively ──────────────────
      // CRITICAL: do NOT touch activeStunRef anywhere else in this component.
      // The old prevStunnedRef was shared with the me.stunned block, which set it
      // to false on every snapshot, causing the stun to re-detect as "new" each time
      // and reset stunRecovery to 0. This is now fixed with a dedicated ref.
      const stunMap     = data.activeStuns || {};
      const myStunEntry = stunMap[playerName];

      // Check if we're currently in an active duel (1v1 takes priority over stun)
      const duelActive = !!(data.activeDuel && (
        data.activeDuel.challengerName===playerName || data.activeDuel.opponentName===playerName ||
        data.activeDuel.challengerUid===playerUid   || data.activeDuel.opponentUid===playerUid
      ));

      if (myStunEntry) {
        if (!activeStunRef.current) {
          // Newly stunned — fire exactly once per stun event
          activeStunRef.current = true;
          if (duelActive) {
            // 1v1 is running — queue stun, show after duel ends
            setPendingStun(myStunEntry);
          } else {
            setIsStunned(true);
            setStunBy(myStunEntry.by || "");
            setStunRecovery(0);
            setStunQIdx(0);
            setStunSelAns(null);
          }
        }
        // If already stunned (activeStunRef.current === true), do nothing — don't reset counters
      } else {
        if (activeStunRef.current) {
          // Stun cleared in Firestore
          activeStunRef.current = false;
          setIsStunned(false);
          setPendingStun(null);
        }
      }

      // ── Duel detection ────────────────────────────────────────────────────
      const ad = data.activeDuel;
      if (ad) {
        const involved = ad.challengerUid===playerUid || ad.opponentUid===playerUid
          || ad.challengerName===playerName || ad.opponentName===playerName;
        if (involved) {
          if (ad.status === "active") {
            if (ad.currentRound !== lastDuelRound.current) {
              lastDuelRound.current = ad.currentRound;
              setDuelAnswered(false);
              setDuelMultiSel([]); setDuelMultiSubmitted(false);
            }
            // Only start countdown for a brand-new duel (round 0).
            // If duelSeenRef were ever spuriously reset mid-duel, currentRound > 0
            // would block a false countdown retrigger.
            if (!duelSeenRef.current && ad.currentRound === 0) {
              duelSeenRef.current = true;
              // Delay 1s before showing countdown so both players have time to load
              setTimeout(() => {
                setDuelCountdown(3);
                clearInterval(duelCountdownRef.current);
                let count = 3;
                duelCountdownRef.current = setInterval(() => {
                  count--;
                  if (count <= 0) {
                    clearInterval(duelCountdownRef.current);
                    setDuelCountdown(null);
                    setPhaseSync("duel");
                  } else {
                    setDuelCountdown(count);
                  }
                }, 1000);
              }, 1000);
            }
          }
          if (ad.status === "done") {
            clearInterval(duelCountdownRef.current);
            setDuelCountdown(null);
            setDuelView("done");
            setPhaseSync("duel");
          }
        }
      } else {
        duelSeenRef.current = false;
        clearInterval(duelCountdownRef.current);
        setDuelCountdown(null);
        setDuelView("active");
      }
    });
  }, [sessionId, playerName, playerUid, isHost, hostIsPlaying]);

  // ── Pick question: reset answers + reshuffle deck at start of each new cycle
  useEffect(() => {
    if (!qList.length) return;
    setSelAns(null);
    setAnsFB(null);
    setMultiSelAnswers([]);
    // When qIdx wraps to the start of a new cycle, build a completely fresh deck
    // Also ensure the last question of prev cycle != first question of new cycle
    if (qIdx > 0 && qIdx % qList.length === 0) {
      const lastQIdx = qList.length > 1 ? qList[(qIdx - 1) % qList.length]?.question : null;
      const randQ = sessionRef.current?.settings?.randomizeQuestions !== false;
      const randA = sessionRef.current?.settings?.randomizeAnswers   !== false;
      setShuffledDeck(buildFreshDeck(qList, randQ, randA));
    }
  }, [qIdx]); // eslint-disable-line

  // ── Auto map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (["rolling","moving","space_roll","rolled"].includes(phase)) setViewMode("map");
    if (["questions","duel"].includes(phase))                       setViewMode("questions");
  }, [phase]);

  // ── Game timer ────────────────────────────────────────────────────────────
  useEffect(() => {
    const endsAt = session?.gameEndsAt;
    if (!endsAt) return;
    clearInterval(gameTimerRef.current);
    const tick = () => {
      const rem = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setGameLeft(rem);
      if (rem <= 0) {
        clearInterval(gameTimerRef.current);
        if (isHost) updateDoc(doc(db,"gameSessions",sessionId),{status:"ended"}).catch(console.error);
      }
    };
    tick();
    gameTimerRef.current = setInterval(tick, 1000);
    return () => clearInterval(gameTimerRef.current);
  }, [session?.gameEndsAt, isHost, sessionId]);

  // ── Question timer ────────────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(qTimerRef.current);
    timerBar.stopAnimation();
    const tl = curQ?.timeLimit || session?.settings?.timePerQuestion;
    // Pause timer while stunned — stun doesn't change phase so we must check explicitly
    if (!tl || phase !== "questions" || isStunned) { setQTimeLeft(null); timerBar.setValue(1); return; }
    timerBar.setValue(1);
    Animated.timing(timerBar, {toValue:0, duration:tl*1000, useNativeDriver:false}).start();
    setQTimeLeft(tl);
    const frozen = curQ;
    qTimerRef.current = setInterval(() => {
      setQTimeLeft(t => {
        if (t === null) return null;
        if (t <= 1) {
          clearInterval(qTimerRef.current);
          setSelAns(-1); setAnsFB("wrong"); setStreak(0); setLuck(0);
          triggerFlash(false, getCorrectText(frozen));
          setTimeout(() => setQIdx(i => i+1), 1400);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(qTimerRef.current);
  }, [qIdx, phase, curQ?.timeLimit, session?.settings?.timePerQuestion]);

  const triggerFlash = useCallback((ok, txt) => {
    setFlashData({isCorrect:ok, text:txt});
    flashOpacity.setValue(1);
    Animated.sequence([
      Animated.delay(900),
      Animated.timing(flashOpacity, {toValue:0, duration:500, useNativeDriver:false}),
    ]).start(() => setFlashData(null));
  }, []);

  const scrollToPos = useCallback((pos, be) => {
    if (!boardRef.current) return;
    const r = Math.floor(pos / BOARD_COLS), total = Math.ceil((be+1) / BOARD_COLS), vr = total - 1 - r;
    boardRef.current.scrollTo({y: Math.max(0, vr*(BASE_TILE+6)-50), animated:true});
  }, []);

  const forceQuestions = useCallback(() => {
    setMBoxOpen(false); setMBoxKey(null); setMBoxDef(null); setMBoxRolling(false);
    setRoll1Notif(false); setShowNotif(false);
    setInterruptedPhase(null);
    const cur = phaseRef.current;
    setPhaseSync("questions"); setViewMode("questions"); setDiceValue(null);
    if (cur === "rolled" || cur === "rolling") setQIdx(i => i+1);
    clearInterval(trapRef.current); setTrapEvent(null); setTrapAnswered(false);
  }, [setPhaseSync]);

  const exitMoving = () => { setPhaseSync("rolled"); setDiceValue(null); };

  const showItemToast = useCallback((type, reason) => {
    const def = INVENTORY_DEFS[type];
    if (!def) return;
    const reasonLine = reason ? ` — ${reason}` : "";
    setItemToast({emoji:def.emoji, text:`${def.label} added to inventory!${reasonLine}`});
    toastAnim.setValue(0);
    Animated.sequence([
      Animated.timing(toastAnim, {toValue:1, duration:300, useNativeDriver:false}),
      Animated.delay(2800),
      Animated.timing(toastAnim, {toValue:0, duration:300, useNativeDriver:false}),
    ]).start(() => setItemToast(null));
  }, []);

  const addToInventory = useCallback((type, reason) => {
    setInventory(prev => {
      if (prev.length >= 3) { setInvFullItem({type, reason}); return prev; }
      const item = {type, id:Date.now()};
      showItemToast(type, reason);
      return [...prev, item];
    });
  }, [showItemToast]);

  const removeFromInventory = useCallback((id) => setInventory(prev => prev.filter(i => i.id !== id)), []);

  const useInventoryItem = useCallback((item) => {
    if (item.type === "mystery_box") {
      openMysteryBox(item.id);
    } else if (item.type === "deflector") {
      // FIX: actually remove from inventory — this was missing, causing infinite deflector
      removeFromInventory(item.id);
      setDeflectorActive(true);
      setDeflectorCharges(2); setDeflectorSecsLeft(30);
      clearTimeout(deflectorTimerRef.current);
      clearInterval(deflectorSecsRef.current);
      deflectorTimerRef.current = setTimeout(() => { setDeflectorActive(false); setDeflectorSecsLeft(0); }, 30000);
      deflectorSecsRef.current  = setInterval(() => setDeflectorSecsLeft(s => { if(s<=1){ clearInterval(deflectorSecsRef.current); return 0; } return s-1; }), 1000);
      const sess = sessionRef.current;
      if (sess) {
        const exp = Date.now() + 30000;
        const upd = (sess.players||[]).map(p =>
          (playerUid&&p.uid===playerUid) || p.name===playerName ? {...p, deflectorExpires:exp} : p
        );
        updateDoc(doc(db,"gameSessions",sessionId), {players:upd}).catch(console.error);
      }
    }
  }, [removeFromInventory, playerName, playerUid, sessionId]);

  const openMysteryBox = useCallback((inventoryItemId = null) => {
    mBoxInventoryItemId.current = inventoryItemId;
    const cur = phaseRef.current;
    savedPhaseRef.current = cur === "moving" ? "rolled" : cur;
    setMBoxOpen(true); setMBoxStep("roll"); setMBoxKey(null); setMBoxDef(null); setMBoxRolling(false);
    setViewMode("map");
  }, []);

  const handleMBoxRoll = useCallback(async () => {
    if (mBoxRolling) return;
    setMBoxRolling(true);
    Animated.sequence([
      Animated.timing(mBoxAnim, {toValue:12, duration:80, useNativeDriver:false}),
      Animated.timing(mBoxAnim, {toValue:-12, duration:80, useNativeDriver:false}),
      Animated.timing(mBoxAnim, {toValue:8, duration:80, useNativeDriver:false}),
      Animated.timing(mBoxAnim, {toValue:0, duration:80, useNativeDriver:false}),
    ]).start();
    await new Promise(r => setTimeout(r, 500));
    const keys = isSolo ? SOLO_MYSTERY_KEYS : MYSTERY_KEYS;
    const defs = isSolo ? SOLO_MYSTERY_DEFS : MYSTERY_DEFS;
    const key = keys[Math.floor(Math.random() * keys.length)];
    const def = defs[key];
    setMBoxKey(key); setMBoxDef(def); setMBoxRolling(false);
    if (def.inventoryType) setMBoxStep("inventory");
    else if (def.needsTarget) setMBoxStep("target");
    else setMBoxStep("apply");
  }, [mBoxRolling]);

  const closeMBox = useCallback((stepAtClose) => {
    setMBoxOpen(false); setMBoxKey(null); setMBoxDef(null);
    const itemId = mBoxInventoryItemId.current;
    mBoxInventoryItemId.current = null;
    // Always consume the mystery box — once you open it, it's gone regardless
    if (itemId) {
      removeFromInventory(itemId);
    }
    const restore = savedPhaseRef.current;
    savedPhaseRef.current = null;
    if (restore && restore !== "questions") {
      setPhaseSync(restore);
      if (["rolling","moving","space_roll"].includes(restore)) setViewMode("map");
      else setViewMode("questions");
    } else {
      setPhaseSync("questions"); setDiceValue(null); setViewMode("questions");
    }
  }, [setPhaseSync, removeFromInventory]);

  const claimMBoxNoTarget = useCallback(async () => {
    if (!mBoxDef) return;
    const willReturnToQ = !savedPhaseRef.current || savedPhaseRef.current === "questions";
    const itemId = mBoxInventoryItemId.current; mBoxInventoryItemId.current = null; if (itemId) removeFromInventory(itemId);
    if (mBoxDef.inventoryType) {
      addToInventory(mBoxDef.inventoryType, "mystery box reward");
      closeMBox();
      if (willReturnToQ) setQIdx(i => i+1);
      return;
    }
    switch (mBoxKey) {
      case "immunity": {
        setImmunityLeft(2); setImmunitySecsLeft(30);
        clearTimeout(immunityTimerRef.current); clearInterval(immunitySecsRef.current);
        immunityTimerRef.current = setTimeout(() => { setImmunityLeft(0); setImmunitySecsLeft(0); }, 45000);
        immunitySecsRef.current  = setInterval(() => setImmunitySecsLeft(s => { if(s<=1){ clearInterval(immunitySecsRef.current); return 0; } return s-1; }), 1000);
        const exp = Date.now() + 45000;
        const sess = sessionRef.current;
        if (sess) {
          const upd = (sess.players||[]).map(p =>
            (playerUid&&p.uid===playerUid)||p.name===playerName ? {...p, immunityExpires:exp} : p
          );
          updateDoc(doc(db,"gameSessions",sessionId), {players:upd}).catch(console.error);
        }
        break;
      }
      case "doubleroll": setDoubleRollsLeft(2); break;
    }
    closeMBox();
    if (willReturnToQ) setQIdx(i => i+1);
  }, [mBoxDef, mBoxKey, addToInventory, closeMBox, removeFromInventory, playerName, playerUid, sessionId]);

  const claimMBoxTarget = useCallback(async (target) => {
    if (!mBoxKey) { closeMBox(); return; }
    const willReturnToQ = !savedPhaseRef.current || savedPhaseRef.current === "questions";
    const itemId2 = mBoxInventoryItemId.current; mBoxInventoryItemId.current = null; if (itemId2) removeFromInventory(itemId2);

    let freshSess;
    try {
      const snap = await getDoc(doc(db,"gameSessions",sessionId));
      freshSess = snap.data();
    } catch(e) { console.error(e); closeMBox(); return; }

    const sess = freshSess || sessionRef.current;
    const tPlayer = (sess.players||[]).find(p => p.name === target.name);
    const tImmune = tPlayer?.immunityExpires > Date.now();
    const tDeflect = tPlayer?.deflectorExpires > Date.now();

    if (tDeflect) {
      // Clear defender's deflector and notify them
      const notifBack = {text:` You deflected ${playerName}'s ${mBoxDef?.title} back at them!`, id:Date.now()};
      const updDeflect = (sess.players||[]).map(p =>
        p.name===target.name ? {...p, deflectorExpires:0, notification:notifBack} : p
      );

      // Actually apply the effect back to the ATTACKER (playerName)
      if (mBoxKey === "stun") {
        // Stun bounces back — write activeStuns for the attacker
        await updateDoc(doc(db,"gameSessions",sessionId), {
          players: updDeflect,
          [`activeStuns.${playerName}`]: { by: `${target.name} (deflected)`, id: Date.now() },
        }).catch(console.error);
      } else if (mBoxKey === "pushback") {
        // Pushback bounces back — push the attacker back 3 spaces
        const myPlayer = (sess.players||[]).find(p => (playerUid&&p.uid===playerUid)||p.name===playerName);
        const np = Math.max(0, (myPlayer?.position||0) - 3);
        const updPB = updDeflect.map(p =>
          (playerUid&&p.uid===playerUid)||p.name===playerName ? {...p, position:np} : p
        );
        await updateDoc(doc(db,"gameSessions",sessionId), {players:updPB}).catch(console.error);
      } else if (mBoxKey === "badluck") {
        // Bad luck bounces back — curse the attacker
        const exp = Date.now() + 45000;
        const updBL = updDeflect.map(p =>
          (playerUid&&p.uid===playerUid)||p.name===playerName ? {...p, badLuckExpires:exp} : p
        );
        await updateDoc(doc(db,"gameSessions",sessionId), {players:updBL}).catch(console.error);
      } else {
        // All other effects (duel etc.) — just clear deflector, no bounce
        updateDoc(doc(db,"gameSessions",sessionId), {players:updDeflect}).catch(console.error);
      }

      setNotif(`Your ${mBoxDef?.title} was deflected back at you by ${target.name}! `);
      setShowNotif(true);
      closeMBox();
      if (willReturnToQ) setQIdx(i => i+1);
      return;
    }

    if (tImmune && ["pushback","stun","badluck","duel"].includes(mBoxKey)) {
      setNotif(`${target.name} is immune! Your ${mBoxDef?.title} was blocked.`);
      setShowNotif(true);
      setMBoxOpen(false); setMBoxKey(null); setMBoxDef(null);
      const restore = savedPhaseRef.current; savedPhaseRef.current = null;
      if (restore && restore !== "questions") { setPhaseSync(restore); setViewMode(["rolling","moving","space_roll"].includes(restore)?"map":"questions"); }
      if (!restore || restore === "questions") setQIdx(i => i+1);
      return;
    }

    switch (mBoxKey) {
      case "pushback": {
        const np = Math.max(0, (target.position||0) - 3);
        const notif = {text:`You were pushed back 3 spaces by ${playerName}! `, id:Date.now()};
        const upd = (sess.players||[]).map(p => p.name===target.name ? {...p, position:np, notification:notif} : p);
        await updateDoc(doc(db,"gameSessions",sessionId), {players:upd}).catch(console.error);
        break;
      }
      case "stun": {
        const notif = {text:`You've been stunned by ${playerName}!  Answer 3 in a row to recover.`, id:Date.now()};
        await updateDoc(doc(db,"gameSessions",sessionId), {
          [`activeStuns.${target.name}`]: { by: playerName, id: Date.now() },
          players: (sess.players||[]).map(p => p.name===target.name ? {...p, notification:notif} : p),
        }).catch(console.error);
        break;
      }
      case "badluck": {
        const exp = Date.now() + 45000;
        const notif = {text:`${playerName} cursed you with Bad Luck Aura! 🌑 –30% Luck for 45s`, id:Date.now()};
        const upd = (sess.players||[]).map(p => p.name===target.name ? {...p, badLuckExpires:exp, notification:notif} : p);
        await updateDoc(doc(db,"gameSessions",sessionId), {players:upd}).catch(console.error);
        break;
      }
      case "duel": {
        const qs = sess.questions || qList;
        if (qs.length) {
          const shuffled = [...qs].sort(() => Math.random()-0.5).slice(0, 3);
          const activeDuel = {
            challengerName:playerName, challengerUid:playerUid||playerName, challengerColor:playerColor,
            opponentName:target.name, opponentUid:target.uid||target.name, opponentColor:target.color||"#888",
            questions:shuffled, currentRound:0, roundStartedAt:Date.now(),
            c_0:null,c_1:null,c_2:null, o_0:null,o_1:null,o_2:null,
            status:"active", winnerName:null,
            challengerDismissed:false, opponentDismissed:false,
          };
          const notif = {text:`${playerName} has challenged you to a 1v1! `, id:Date.now()};
          const updP = (sess.players||[]).map(p => p.name===target.name ? {...p, notification:notif} : p);
          await updateDoc(doc(db,"gameSessions",sessionId), {activeDuel, players:updP}).catch(console.error);
        }
        setMBoxOpen(false); setMBoxKey(null); setMBoxDef(null);
        setPhaseSync("questions"); setDiceValue(null);
        return;
      }
    }
    closeMBox();
    if (willReturnToQ) setQIdx(i => i+1);
  }, [mBoxKey, mBoxDef, playerName, playerUid, playerColor, sessionId, closeMBox, removeFromInventory, qList]);

  // ── 1v1 Duel answer ───────────────────────────────────────────────────────
  const handleDuelAnswer = useCallback(async (ansIdx, correctOverride) => {
    if (duelAnswered) return;
    const sess = sessionRef.current;
    if (!sess?.activeDuel || sess.activeDuel.status !== "active") return;
    const ad = sess.activeDuel, r = ad.currentRound;
    const isChallenger = ad.challengerUid===playerUid || ad.challengerName===playerName;
    const myKey  = isChallenger ? `c_${r}` : `o_${r}`;
    const othKey = isChallenger ? `o_${r}` : `c_${r}`;
    const q = ad.questions[r];
    // correctOverride used for multiSelect (pre-computed before calling)
    const correct = correctOverride !== undefined ? correctOverride : (q?.correctAnswers?.[ansIdx] === true);
    const timeSec = Math.max(0, (Date.now() - ad.roundStartedAt) / 1000);
    setDuelAnswered(true);
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db,"gameSessions",sessionId);
        const snap = await tx.get(ref);
        const d = snap.data(), duel = d.activeDuel;
        if (!duel || duel.status !== "active") return;
        if (duel[myKey] !== null) return;
        const upd = {[`activeDuel.${myKey}`]: {correct, timeSec}};
        const other = duel[othKey];
        if (other !== null) {
          const nextR = r + 1;
          if (nextR >= 3) {
            const cA = [duel.c_0,duel.c_1,duel.c_2].map((a,i) => (isChallenger&&i===r) ? {correct,timeSec} : a);
            const oA = [duel.o_0,duel.o_1,duel.o_2].map((a,i) => (!isChallenger&&i===r) ? {correct,timeSec} : a);
            const cC = cA.filter(a=>a?.correct).length;
            const oC = oA.filter(a=>a?.correct).length;
            const cT = cA.reduce((s,a)=>s+(a?.timeSec||0),0)/3;
            const oT = oA.reduce((s,a)=>s+(a?.timeSec||0),0)/3;
            let winner;
            if (cC > oC) winner = duel.challengerName;
            else if (oC > cC) winner = duel.opponentName;
            else if (cT < oT) winner = duel.challengerName;
            else if (oT < cT) winner = duel.opponentName;
            else winner = "tie";
            upd["activeDuel.status"] = "done";
            upd["activeDuel.winnerName"] = winner;
          } else {
            upd["activeDuel.currentRound"] = nextR;
            upd["activeDuel.roundStartedAt"] = Date.now();
          }
        }
        tx.update(ref, upd);
      });
    } catch(e) { console.error("duelAnswer:", e); }
  }, [duelAnswered, playerName, playerUid, sessionId]);

  // Duel multiSelect: toggle + confirm (same pattern as normal multiSelect)
  const handleDuelMultiToggle = useCallback((i) => {
    if (duelAnswered || duelMultiSubmitted) return;
    setDuelMultiSel(prev => prev.includes(i) ? prev.filter(x=>x!==i) : [...prev, i]);
  }, [duelAnswered, duelMultiSubmitted]);

  const handleDuelMultiConfirm = useCallback(async () => {
    if (duelAnswered || duelMultiSubmitted) return;
    const sess = sessionRef.current;
    if (!sess?.activeDuel || sess.activeDuel.status !== "active") return;
    const ad = sess.activeDuel, r = ad.currentRound;
    const q = ad.questions[r];
    if (!q) return;
    setDuelMultiSubmitted(true);
    const correctIdxs = (q.correctAnswers||[]).map((v,i)=>v?i:null).filter(x=>x!==null);
    const selected = [...duelMultiSel].sort((a,b)=>a-b);
    const sortedCorrect = [...correctIdxs].sort((a,b)=>a-b);
    const correct = selected.length === sortedCorrect.length && selected.every((v,i)=>v===sortedCorrect[i]);
    // ansIdx -2 = multiselect sentinel
    await handleDuelAnswer(-2, correct);
  }, [duelAnswered, duelMultiSubmitted, duelMultiSel, handleDuelAnswer]);

  // ── Dismiss duel — applies any pending stun after duel ends ──────────────
  const dismissDuel = useCallback(async () => {
    const ad = sessionRef.current?.activeDuel;
    const me = myStateRef.current;
    if (!ad) { setPhaseSync("questions"); setQIdx(i=>i+1); return; }
    const isChallenger = ad.challengerName===playerName || ad.challengerUid===playerUid;
    const myKey  = isChallenger ? "challengerDismissed" : "opponentDismissed";
    const othKey = isChallenger ? "opponentDismissed" : "challengerDismissed";

    if (ad.winnerName === playerName) {
      const otherName = isChallenger ? ad.opponentName : ad.challengerName;
      const opp = (sessionRef.current?.players||[]).find(p => p.name===otherName);
      const myPos = me?.position||0, oppPos = opp?.position||0;
      if (opp && myPos < oppPos) {
        const upd = (sessionRef.current.players||[]).map(p => {
          if ((playerUid&&p.uid===playerUid)||p.name===playerName) return {...p, position:oppPos};
          if (p.name===otherName) return {...p, position:myPos};
          return p;
        });
        await updateDoc(doc(db,"gameSessions",sessionId), {players:upd}).catch(console.error);
      }
    }

    if (ad[othKey]) {
      await updateDoc(doc(db,"gameSessions",sessionId), {activeDuel:null}).catch(console.error);
    } else {
      await updateDoc(doc(db,"gameSessions",sessionId), {[`activeDuel.${myKey}`]:true}).catch(console.error);
    }
    setDuelView("active");
    // Brief pause so the transition doesn't feel jarring
    setTimeout(() => {
      setPhaseSync("questions");
      setQIdx(i => i+1);
    }, 800);

    // Apply any stun that arrived while we were in the duel
    setPendingStun(prev => {
      if (prev) {
        setIsStunned(true);
        setStunBy(prev.by || "");
        setStunRecovery(0);
        setStunQIdx(0);
        setStunSelAns(null);
      }
      return null;
    });
  }, [playerName, playerUid, sessionId]);

  // ── Answer handlers ───────────────────────────────────────────────────────
  const handleMultiToggle = useCallback((ansIdx) => {
    if (selAns !== null || phase !== "questions") return;
    setMultiSelAnswers(prev =>
      prev.includes(ansIdx) ? prev.filter(i => i !== ansIdx) : [...prev, ansIdx]
    );
  }, [selAns, phase]);

  const scoreAndAdvance = useCallback((correct) => {
    if (correct) {
      const ns = streak+1, nc = cc+1;
      setStreak(ns); setLuck(Math.min(40, ns>=2 ? luck+5 : luck));
      // Write streak/luck to Firestore for host leaderboard
      const newLuck = Math.min(40, ns>=2 ? luck+5 : luck);
      if (sessionId && playerName) {
        const sess = sessionRef.current;
        if (sess?.players) {
          const upd = sess.players.map(p => p.name===playerName ? {...p, streak:ns, luck:newLuck} : p);
          updateDoc(doc(db,"gameSessions",sessionId), {players:upd}).catch(()=>{});
        }
      }
      setTotal(prev => { const next=prev+1; const trigger=isSolo?(Math.random()<0.30):(next%6===0); if(trigger) { addToInventory("mystery_box","mystery box"); }
      if (ns === 20) { addToInventory("nuke","Nuke — stuns ALL other players!"); } return next; });
      if (nc >= ROLL_AT) { setCc(0); setTimeout(() => { setPhaseSync("rolling"); setDiceValue(null); }, 1400); }
      else { setCc(nc); setTimeout(() => setQIdx(i => i+1), 1400); }
    } else {
      setStreak(0); setLuck(0);
      setTimeout(() => setQIdx(i => i+1), 1400);
      if (sessionId && playerName) {
        const sess = sessionRef.current;
        if (sess?.players) {
          const upd = sess.players.map(p => p.name===playerName ? {...p, streak:0, luck:0} : p);
          updateDoc(doc(db,"gameSessions",sessionId), {players:upd}).catch(()=>{});
        }
      }
    }
  }, [streak, cc, luck, addToInventory, setPhaseSync]);

  const handleMultiConfirm = useCallback(() => {
    if (selAns !== null || phase !== "questions" || !curQ) return;
    clearInterval(qTimerRef.current); timerBar.stopAnimation();
    const correctIdxs = (curQ.correctAnswers||[]).map((v,i)=>v?i:null).filter(x=>x!==null);
    const selected = [...multiSelAnswers].sort((a,b)=>a-b);
    const sortedCorrect = [...correctIdxs].sort((a,b)=>a-b);
    const correct = selected.length === sortedCorrect.length && selected.every((v,i) => v === sortedCorrect[i]);
    setSelAns(-2);
    setAnsFB(correct ? "correct" : "wrong");
    triggerFlash(correct, getCorrectText(curQ));
    scoreAndAdvance(correct);
  }, [selAns, phase, curQ, multiSelAnswers, triggerFlash, scoreAndAdvance]);

  const handleAnswer = useCallback((ansIdx) => {
    if (selAns !== null || phase !== "questions") return;
    clearInterval(qTimerRef.current); timerBar.stopAnimation();
    const correct = curQ?.correctAnswers?.[ansIdx] === true;
    setSelAns(ansIdx);
    setAnsFB(correct ? "correct" : "wrong");
    triggerFlash(correct, getCorrectText(curQ));
    scoreAndAdvance(correct);
  }, [selAns, phase, curQ, triggerFlash, scoreAndAdvance]);

  // ── Stun Modal answer handler ─────────────────────────────────────────────
  const handleStunAnswer = useCallback((ansIdx) => {
    if (stunSelAns !== null) return;
    const q = qList[stunQIdx % qList.length];
    if (!q) return;
    const correct = q?.correctAnswers?.[ansIdx] === true;
    setStunSelAns(ansIdx);
    if (correct) {
      const ns = stunRecovery + 1;
      setStunRecovery(ns);
      if (ns >= ROLL_AT) {
        updateDoc(doc(db,"gameSessions",sessionId), {
          [`activeStuns.${playerName}`]: deleteField(),
        }).catch(console.error);
        setTimeout(() => {
          setStunRecovery(0); setStunQIdx(0); setStunSelAns(null);
          setStunMultiSel([]); setStunMultiSubmitted(false);
          setIsStunned(false); activeStunRef.current = false;
          // Show "rolled" screen briefly so the player sees they're free
          setPhaseSync("rolled");
        }, 1800);
        return;
      }
    } else {
      setStunRecovery(0);
    }
    setTimeout(() => {
      setStunQIdx(i => i+1);
      setStunSelAns(null);
      setStunMultiSel([]);
      setStunMultiSubmitted(false);
    }, 1200);
  }, [stunSelAns, stunQIdx, stunRecovery, qList, playerName, sessionId]);

  // Stun multiSelect handlers
  const handleStunMultiToggle = useCallback((i) => {
    if (stunSelAns !== null || stunMultiSubmitted) return;
    setStunMultiSel(prev => prev.includes(i) ? prev.filter(x=>x!==i) : [...prev, i]);
  }, [stunSelAns, stunMultiSubmitted]);

  const handleStunMultiConfirm = useCallback(() => {
    if (stunMultiSubmitted || stunSelAns !== null) return;
    const q = qList[stunQIdx % qList.length];
    if (!q) return;
    setStunMultiSubmitted(true);
    const correctIdxs = (q.correctAnswers||[]).map((v,i)=>v?i:null).filter(x=>x!==null);
    const selected = [...stunMultiSel].sort((a,b)=>a-b);
    const sortedCorrect = [...correctIdxs].sort((a,b)=>a-b);
    const correct = selected.length === sortedCorrect.length && selected.every((v,i)=>v===sortedCorrect[i]);
    // Use -2 sentinel to mark multiselect submitted
    setStunSelAns(-2);
    if (correct) {
      const ns = stunRecovery + 1;
      setStunRecovery(ns);
      if (ns >= ROLL_AT) {
        updateDoc(doc(db,"gameSessions",sessionId), {
          [`activeStuns.${playerName}`]: deleteField(),
        }).catch(console.error);
        setTimeout(() => {
          setStunRecovery(0); setStunQIdx(0); setStunSelAns(null);
          setStunMultiSel([]); setStunMultiSubmitted(false);
          setIsStunned(false); activeStunRef.current = false;
          setPhaseSync("rolled");
        }, 1800);
        return;
      }
    } else {
      setStunRecovery(0);
    }
    setTimeout(() => {
      setStunQIdx(i=>i+1); setStunSelAns(null);
      setStunMultiSel([]); setStunMultiSubmitted(false);
    }, 1200);
  }, [stunMultiSubmitted, stunSelAns, stunQIdx, stunMultiSel, stunRecovery, qList, playerName, sessionId]);

  const handleRoll = useCallback(async () => {
    if (diceRolling) return;
    setDiceRolling(true);
    Animated.sequence([
      Animated.timing(diceAnim,{toValue:10, duration:80,useNativeDriver:false}),
      Animated.timing(diceAnim,{toValue:-10,duration:80,useNativeDriver:false}),
      Animated.timing(diceAnim,{toValue:8,  duration:80,useNativeDriver:false}),
      Animated.timing(diceAnim,{toValue:0,  duration:80,useNativeDriver:false}),
    ]).start();
    await new Promise(r => setTimeout(r, 500));
    let roll = Math.floor(Math.random()*6)+1;
    if (doubleRollsLeft > 0) { roll = roll + Math.floor(Math.random()*6)+1; setDoubleRollsLeft(n=>n-1); }
    else if (luck > 0) { const r2=Math.floor(Math.random()*6)+1; if(luck>=20) roll=Math.max(roll,r2); }
    if (streak >= 8) roll = Math.min(12, roll+1);
    setDiceValue(roll); setDiceRolling(false);
    if (roll === 1 && doubleRollsLeft === 0) {
      addToInventory("mystery_box", "you rolled a 1! 🎲");
      setPhaseSync("rolled");
      return;
    }
    setTimeout(() => movePlayer(roll), 800);
  }, [diceRolling, luck, streak, doubleRollsLeft, addToInventory]);

  const handleSpaceRoll = useCallback(async () => {
    if (srRolling) return;
    setSrRolling(true);
    Animated.sequence([
      Animated.timing(srAnim,{toValue:10, duration:80,useNativeDriver:false}),
      Animated.timing(srAnim,{toValue:-10,duration:80,useNativeDriver:false}),
      Animated.timing(srAnim,{toValue:8,  duration:80,useNativeDriver:false}),
      Animated.timing(srAnim,{toValue:0,  duration:80,useNativeDriver:false}),
    ]).start();
    await new Promise(r => setTimeout(r, 500));
    const roll = Math.floor(Math.random()*6)+1;
    setSrValue(roll); setSrRolling(false);
    setTimeout(() => applySpaceRoll(srType, roll), 800);
  }, [srRolling, srType]);

  const applySpaceRoll = useCallback(async (type, roll) => {
    const sess = sessionRef.current;
    if (!sess) { setSrType(null); exitMoving(); return; }
    const be  = sess.settings?.boardSize || 40;
    // Use the captured landing position — NOT myStateRef.position which may be stale
    // if the Firestore snapshot hasn't fired yet when the player taps Roll
    const cur = srLandingPos.current ?? (myStateRef.current?.position || 0);
    srLandingPos.current = null; // clear after use
    const np = type==="lava" ? Math.max(0, cur-roll) : Math.min(be, cur+roll);
    setPhaseSync("moving");
    const srSafetyTimer = setTimeout(() => { if (phaseRef.current === "moving") setPhaseSync("rolled"); }, 8000);
    const step = type==="lava" ? -1 : 1;
    for (let p=cur; step>0?p<=np:p>=np; p+=step) { setHighlightPos(p); scrollToPos(p,be); await new Promise(r=>setTimeout(r,280)); }
    setHighlightPos(np);
    try {
      const finAt = Date.now();
      const upd = (sessionRef.current?.players||[]).map(p =>
        (playerUid&&p.uid===playerUid)||p.name===playerName ? {...p,position:np,color:playerColor} : p
      );
      await updateDoc(doc(db,"gameSessions",sessionId), {players:upd});
      clearTimeout(srSafetyTimer);
      if (np>=be) {
        // Record finish time on the player entry so GameOver can show ms-accurate times
        const updFin = upd.map(p =>
          (playerUid&&p.uid===playerUid)||p.name===playerName ? {...p, finishedAt:finAt} : p
        );
        await updateDoc(doc(db,"gameSessions",sessionId),{status:"ended",winner:playerName,players:updFin});
        return;
      }
    } catch(e) { clearTimeout(srSafetyTimer); console.error(e); }
    setSrType(null); setSrValue(null); exitMoving();
  }, [playerName,playerColor,playerUid,sessionId,scrollToPos]);

  const movePlayer = useCallback(async (spaces) => {
    const me=myStateRef.current, sess=sessionRef.current;
    if (!me||!sess) { setPhaseSync("questions"); setDiceValue(null); return; }
    const be=sess.settings?.boardSize||40, op=me.position||0, np=Math.min(op+spaces,be);
    setPhaseSync("moving");
    const safetyTimer = setTimeout(() => { if (phaseRef.current === "moving") setPhaseSync("rolled"); }, 8000);
    for (let c=op; c<=np; c++) { setHighlightPos(c); scrollToPos(c,be); await new Promise(r=>setTimeout(r,280)); }
    setHighlightPos(np);
    try {
      const ls = sessionRef.current;
      const finAt = Date.now();
      const upd = (ls?.players||[]).map(p =>
        (playerUid&&p.uid===playerUid)||p.name===playerName ? {...p,position:np,color:playerColor} : p
      );
      await updateDoc(doc(db,"gameSessions",sessionId), {players:upd});
      clearTimeout(safetyTimer);
      if (np>=be) {
        const updFin = upd.map(p =>
          (playerUid&&p.uid===playerUid)||p.name===playerName ? {...p, finishedAt:finAt} : p
        );
        await updateDoc(doc(db,"gameSessions",sessionId),{status:"ended",winner:playerName,players:updFin});
        return;
      }
      const space = (() => { const b=ls?.board||[]; const d=b[np]; if(d?.type) return d; return (Array.isArray(b)&&b.find(s=>s?.index===np))||null; })();
      handleLanding(space, np, be, ls?.questions||[]);
    } catch(e) { clearTimeout(safetyTimer); console.error("movePlayer:",e); exitMoving(); }
  }, [playerName,playerColor,playerUid,sessionId,scrollToPos]);

  const handleLanding = (space, pos, be, qs) => {
    const type = space?.type || "normal";
    if (immunityLeft>0 && ["lava","trap","cannon"].includes(type)) { setImmunityLeft(n=>Math.max(0,n-1)); exitMoving(); return; }
    if (immunityLeft>0 && type!=="normal") setImmunityLeft(n=>Math.max(0,n-1));
    if (type==="normal") { exitMoving(); return; }
    if (type==="mystery") { openMysteryBox(); return; }
    if (type==="lava"||type==="cannon") {
      srLandingPos.current = pos; // capture exact position — avoids snapshot race in applySpaceRoll
      setSrType(type); setSrValue(null); setSrRolling(false); setPhaseSync("space_roll"); return;
    }
    if (type==="trap") {
      const pool = qs?.length ? qs : [];
      if (pool.length) {
        const trapQ = pool[Math.floor(Math.random()*pool.length)];
        setTrapEvent({question:trapQ}); setTrapTimer(10);
        setTrapAnswered(false); setTrapMultiSel([]); setTrapMultiDone(false);
        setPhaseSync("space_event");
        clearInterval(trapRef.current);
        trapRef.current = setInterval(() => {
          setTrapTimer(t => { if(t<=1){ clearInterval(trapRef.current); handleTrapFail(); return 0; } return t-1; });
        }, 1000);
      } else { exitMoving(); }
      return;
    }
    exitMoving();
  };

  const handleTrapFail = async () => {
    clearInterval(trapRef.current);
    setTrapEvent(null); setTimeout(()=>{ setPhaseSync("questions"); setDiceValue(null); setQIdx(i=>i+1); }, 1500);
    await updateDoc(doc(db,"gameSessions",sessionId), {
      [`activeStuns.${playerName}`]: { by: "Trap", id: Date.now() },
    }).catch(console.error);
  };

  const resolveEvent = async (opts={}) => {
    clearInterval(trapRef.current);
    setTrapEvent(null); setTimeout(()=>{ setPhaseSync("questions"); setDiceValue(null); setQIdx(i=>i+1); }, 1500);
    if (trapEvent?.question && !opts.correct) {
      await updateDoc(doc(db,"gameSessions",sessionId), {
        [`activeStuns.${playerName}`]: { by: "Trap", id: Date.now() },
      }).catch(console.error);
    }
  };

  const handleLeave = async () => {
    if (!isHost || hostIsPlaying) {
      try {
        const sess = sessionRef.current;
        if (sess) {
          const upd = (sess.players||[]).filter(p => !(playerUid&&p.uid===playerUid) && p.name!==playerName);
          await updateDoc(doc(db,"gameSessions",sessionId),{players:upd});
        }
      } catch(e) { console.error(e); }
    }
    const isReal = auth.currentUser && !auth.currentUser.isAnonymous;
    navigation.reset({index:0, routes:[{name:isReal?"Dashboard":"Home"}]});
  };

  const exitGame = () => {
    const isReal = auth.currentUser && !auth.currentUser.isAnonymous;
    navigation.reset({index:0, routes:[{name:isReal?"Dashboard":"Home"}]});
  };

  if (loading) return (
    <SafeAreaView style={S.center}>
      <ActivityIndicator size="large" color="#00c781"/>
      <Text style={{color:"#fff",marginTop:16,fontSize:18}}>Loading…</Text>
    </SafeAreaView>
  );

  const board    = session?.board || [];
  const players  = session?.players || [];
  const boardEnd = session?.settings?.boardSize || 40;
  const myPos    = myState?.position || 0;
  const showCA   = session?.settings?.showAnswersAfter !== false;
  const badLuck  = myState?.badLuckExpires && myState.badLuckExpires > Date.now();
  const effLuck  = badLuck ? Math.max(0, luck-30) : luck;
  const dispLuck = Math.min(100, Math.round(effLuck * 2.5));
  const otherPs  = players.filter(p => !((playerUid&&p.uid===playerUid)||p.name===playerName));
  const activeDuel = session?.activeDuel;

  // ══ HOST VIEW ════════════════════════════════════════════════════════════
  if (isHost && !hostIsPlaying) {
    const sorted = [...players].sort((a,b) => (b.position||0)-(a.position||0));
    return (
      <SafeAreaView style={S.container}>
        <View style={S.hostHeader}>
          <Text style={S.hostTitle}>Brain Board — Host</Text>
          <View style={{flexDirection:"row",gap:12,alignItems:"center"}}>
            {gameLeft!=null&&<Text style={[S.timerTxt,gameLeft<=30&&{color:"#e74c3c"}]}>{formatTime(gameLeft)}</Text>}
            <TouchableOpacity style={S.endBtn} onPress={async()=>{await updateDoc(doc(db,"gameSessions",sessionId),{status:"ended"}).catch(console.error);exitGame();}}>
              <Text style={S.endBtnTxt}>End Game</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={S.hostBody}>
          <ScrollView ref={boardRef} style={{flex:1}} contentContainerStyle={{padding:12}}>
            <SnakeBoard board={board} players={players} myPosition={-1} myPlayerName={playerName} myPlayerColor={playerColor} highlightPos={null} boardEnd={boardEnd}
              tileSize={Math.min(Math.floor((winW-420)/(calcBoardCols(boardEnd)+2)), Math.floor((winH*0.88)/(Math.ceil((boardEnd+1)/calcBoardCols(boardEnd))+1)), 72)}/>
            <Legend/>
          </ScrollView>
          <View style={S.hostSide}>
            <Text style={S.lbTitle}>Leaderboard</Text>
            {sorted.slice(0,10).map((p,i)=>(
              <View key={p.name} style={[S.lbRow,{paddingVertical:10,paddingHorizontal:12}]}>
                <Text style={[S.lbRank,{fontSize:16,minWidth:32}]}>#{i+1}</Text>
                <Pawn color={p.color||"#888"} size={24}/>
                <View style={{flex:1,marginLeft:8,marginRight:8}}>
                  <Text style={[S.lbName,{fontSize:14}]} numberOfLines={1}>{p.name}</Text>
                  <View style={{flexDirection:"row",marginTop:2}}>
                    <Text style={{color:"#f39c12",fontSize:11,marginRight:10}}>Streak x{p.streak||0}</Text>
                    <Text style={{color:"#2ecc71",fontSize:11}}>Luck {p.luck||0}%</Text>
                  </View>
                </View>
                <Text style={[S.lbPos,{fontSize:15,fontWeight:"bold"}]}>{p.position||0}/{boardEnd}</Text>
              </View>
            ))}
          </View>
        </View>
        <Modal visible={showLeave} transparent animationType="fade">
        <View style={S.mOverlay}>
          <View style={S.mBox}>
            <Text style={S.mTtl}>Leave Game?</Text>
            <Text style={S.mDesc}>Are you sure you want to leave?</Text>
            <View style={{flexDirection:"row",gap:12,marginTop:16}}>
              <TouchableOpacity style={[S.rollBtn,{flex:1,backgroundColor:"#00c781"}]} onPress={()=>setShowLeave(false)}>
                <Text style={S.rollTxtBig}>Stay</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.rollBtn,{flex:1,backgroundColor:"#c0392b"}]} onPress={()=>{setShowLeave(false);exitGame();}}>
                <Text style={S.rollTxtBig}>Leave</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {session?.status==="ended"&&!gameOverDone&&<GameOverModal session={session} myPos={-1} boardEnd={boardEnd} onExit={()=>{setGameOverDone(true);exitGame();}}/>}
      </SafeAreaView>
    );
  }

  // ══ PLAYER VIEW ══════════════════════════════════════════════════════════
  const showMap = viewMode === "map";

  return (
    <SafeAreaView style={[S.container, isStunned&&S.containerStunned]}>

      <View style={[S.hud, isStunned&&S.hudStunned, {paddingVertical:Math.max(6,10*rs),paddingHorizontal:Math.max(6,10*rs),flexWrap:"wrap",rowGap:6}]}>
        {[["STREAK","x"+streak,streak>0?"#f39c12":"#888","streak"],
          ["LUCK",`${dispLuck}%`,badLuck?"#e74c3c":"#2ecc71","luck"],
          ["SPACE",`${myPos}/${boardEnd}`,playerColor,"space"],
        ].map(([lbl,val,col,icon])=>(
          <View key={lbl} style={{alignItems:"center",paddingHorizontal:Math.max(6,10*rs),minWidth:Math.max(48,58*rs)}}>
            <Text style={{color:"#777",fontSize:Math.max(10,13*rs),letterSpacing:1,fontWeight:"800"}}>{lbl}</Text>
            <Text style={{color:col||"#fff",fontSize:Math.max(20,28*rs),fontWeight:"bold",marginTop:2}}>{val}</Text>
          </View>
        ))}
        {immunityLeft>0&&<View style={{alignItems:"center",paddingHorizontal:Math.max(3,6*rs)}}><Text style={{color:"#555",fontSize:Math.max(10,13*rs),fontWeight:"800"}}>SHIELD</Text><Text style={{color:"#2ecc71",fontSize:Math.max(16,24*rs),fontWeight:"bold",marginTop:2}}>{immunityLeft}·{immunitySecsLeft}s</Text></View>}
        {deflectorActive&&<View style={{alignItems:"center",paddingHorizontal:Math.max(3,6*rs)}}><Text style={{color:"#555",fontSize:Math.max(10,13*rs),fontWeight:"800"}}>REFLECT</Text><Text style={{color:"#00bcd4",fontSize:Math.max(12,18*rs),fontWeight:"bold",marginTop:2}}>{deflectorSecsLeft}ss</Text></View>}
        {doubleRollsLeft>0&&<View style={{alignItems:"center",paddingHorizontal:Math.max(3,6*rs)}}><Text style={{color:"#555",fontSize:Math.max(10,13*rs),fontWeight:"800"}}>2×ROLL</Text><Text style={{color:"#9b59b6",fontSize:Math.max(12,18*rs),fontWeight:"bold",marginTop:2}}>×{doubleRollsLeft}</Text></View>}

        <Pressable style={({hovered,pressed})=>[S.qBtn,phase==="questions"&&!showMap&&S.qBtnActive,{paddingHorizontal:Math.max(6,10*rs),paddingVertical:Math.max(4,7*rs)}, Platform.OS==='web'&&hovered&&{backgroundColor:'#002800',borderColor:'#00c781'}, pressed&&{opacity:0.8}]} onPress={forceQuestions}>
          <Text style={[S.qBtnTxt,{fontSize:Math.max(9,11*rs)}]}>Questions</Text>
        </Pressable>
        <Pressable style={({hovered,pressed})=>[S.mapBtn,showMap&&S.mapBtnOn,{paddingHorizontal:Math.max(6,10*rs),paddingVertical:Math.max(4,7*rs)}, Platform.OS==='web'&&hovered&&{backgroundColor:'#001a12',borderColor:'#00c781'}, pressed&&{opacity:0.8}]} onPress={()=>setViewMode(v=>v==="map"?"questions":"map")}>
          <Text style={[S.mapBtnTxt,{fontSize:Math.max(10,13*rs)}]}>Map</Text>
        </Pressable>
        {gameLeft!=null&&<View style={{alignItems:"center",paddingHorizontal:Math.max(4,8*rs)}}><Text style={{color:"#777",fontSize:Math.max(9,11*rs),fontWeight:"800"}}>TIME</Text><Text style={{color:gameLeft<=30?"#e74c3c":"#fff",fontSize:Math.max(16,22*rs),fontWeight:"bold"}}>{formatTime(gameLeft)}</Text></View>}
        <TouchableOpacity style={{backgroundColor:"#2a0000",borderRadius:8,paddingHorizontal:Math.max(8,12*rs),paddingVertical:Math.max(4,7*rs),borderWidth:1,borderColor:"#5a0000",marginLeft:"auto"}} onPress={()=>setShowLeave(true)}>
          <Text style={{color:"#ff6b6b",fontSize:Math.max(10,12*rs),fontWeight:"bold"}}>Leave</Text>
        </TouchableOpacity>
        {hostIsPlaying&&<TouchableOpacity style={[S.hudEndBtn,{paddingHorizontal:Math.max(8,12*rs),paddingVertical:Math.max(6,10*rs)}]} onPress={async()=>{await updateDoc(doc(db,"gameSessions",sessionId),{status:"ended"}).catch(console.error);exitGame();}}><Text style={[S.hudEndBtnTxt,{fontSize:Math.max(10,13*rs)}]}>End</Text></TouchableOpacity>}
      </View>

      {!!(curQ?.timeLimit||session?.settings?.timePerQuestion) && phase==="questions" && !showMap && (
        <View style={S.timerTrack}>
          <Animated.View style={[S.timerFill, {width:timerBar.interpolate({inputRange:[0,1],outputRange:["0%","100%"]})}]}/>
        </View>
      )}

      <View style={S.main}>
        {showMap && (
          <View style={{flex:1, alignItems:"center", justifyContent:"center", overflow:"hidden"}}>
            <SnakeBoard board={board} players={players} myPosition={myPos} myPlayerName={playerName} myPlayerColor={playerColor} highlightPos={highlightPos} boardEnd={boardEnd}
              tileSize={Math.min(Math.floor((winW-32)/(calcBoardCols(boardEnd)+2)), Math.floor((winH*0.78)/(Math.ceil((boardEnd+1)/calcBoardCols(boardEnd))+1)), 72)}/>
            <Legend/>
          </View>
        )}

        {!showMap && phase==="questions" && (
          <ScrollView style={{flex:1}} contentContainerStyle={[S.qScroll, isMobile && {padding:10, paddingBottom:80}]}>
            <View style={S.rollBar}>
              {[0,1,2].map(i=><View key={i} style={[S.rollDot,i<cc&&S.rollDotOn]}/>)}
              <Text style={S.rollTxt2}>{ROLL_AT-cc} more correct to roll</Text>
            </View>
            {curQ ? (
              <View style={S.qCard}>
                {curQ.imageUrl ? (
                  <TouchableOpacity onPress={()=>setZoomImage(curQ.imageUrl)} activeOpacity={0.85}>
                    <Image source={{uri:curQ.imageUrl}} style={S.qImage} resizeMode="contain"/>
                    <Text style={S.zoomHint}>Tap to zoom</Text>
                  </TouchableOpacity>
                ) : null}
                <Text style={[S.qTxt, isMobile&&{fontSize:16,lineHeight:22}]}>{curQ.question}</Text>
                {curQ.type==="multiSelect" ? (
                  <>
                    <Text style={{color:"#888",fontSize:13,marginBottom:8,textAlign:"center"}}>Select ALL correct answers, then tap Confirm</Text>
                    <View style={S.aGrid}>
                      {(curQ.answers||[]).map((ans,i) => {
                        const isSel=multiSelAnswers.includes(i);
                        const isCorr=curQ.correctAnswers?.[i]===true;
                        let bg=isSel?"#001d33":"#1c1c1c", bc=isSel?"#3498db":"#383838";
                        if(selAns!=null&&isCorr&&showCA){bg="#003d1a";bc="#00c781";}
                        if(selAns!=null&&isSel&&!isCorr){bg="#3d0000";bc="#e74c3c";}
                        return (
                          <TouchableOpacity key={i}
                            style={[S.aBtn,{backgroundColor:bg,borderColor:bc,flexDirection:"row",alignItems:"center"}]}
                            onPress={()=>handleMultiToggle(i)} disabled={selAns!==null} activeOpacity={0.75}>
                            <View style={{width:32,alignItems:"center"}}>
                              <Text style={{fontSize:20,color:isSel?"#3498db":"#444"}}>{isSel?"☑":"☐"}</Text>
                            </View>
                            <Text style={[S.aTxt,{flex:1,textAlign:"left"}]}>{ans}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <TouchableOpacity
                      style={[S.rollBtn,{backgroundColor:"#3498db",marginTop:12,alignSelf:"center",opacity:selAns===null&&multiSelAnswers.length>0?1:0}]}
                      onPress={handleMultiConfirm}
                      disabled={selAns!==null||multiSelAnswers.length===0}>
                      <Text style={S.rollTxtBig}>Confirm</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={S.aGrid}>
                    {(curQ.type==="multipleChoice"?curQ.answers:["True","False"]).map((ans,i)=>{
                      const isSel=selAns===i, isCorr=curQ.correctAnswers?.[i]===true;
                      let bg="#1c1c1c",bc="#383838";
                      if(isSel){bg=ansFB==="correct"?"#003d1a":"#3d0000";bc=ansFB==="correct"?"#00c781":"#e74c3c";}
                      else if(selAns!==null&&isCorr&&showCA){bg="#003d1a";bc="#00c781";}
                      return (<Pressable key={i} style={({hovered,pressed})=>[S.aBtn,{backgroundColor:bg,borderColor:bc}, Platform.OS==='web'&&hovered&&selAns===null&&{transform:[{scale:1.02}],borderColor:'#aaa'}, pressed&&{opacity:0.8}]} onPress={()=>handleAnswer(i)} disabled={selAns!==null}><Text style={[S.aTxt, isMobile&&{fontSize:13}]}>{ans}</Text></Pressable>);
                    })}
                  </View>
                )}
              </View>
            ) : <View style={S.waitBox}><ActivityIndicator color="#00c781"/><Text style={S.waitTxt}>Loading…</Text></View>}
          </ScrollView>
        )}

        {phase==="rolling" && (
          <View style={[S.diceBox, showMap && {borderTopWidth:1, borderTopColor:"#222"}]}>
            <Text style={{color:"#fff",fontSize:Math.max(16,20*rs),fontWeight:"bold",textAlign:"center"}}>Roll the Dice!</Text>
            {doubleRollsLeft>0&&<Text style={[S.luckTxt,{color:"#9b59b6",fontSize:Math.max(11,14*rs)}]}>Double Roll active!</Text>}
            {effLuck>0&&doubleRollsLeft===0&&<Text style={[S.luckTxt,{fontSize:Math.max(11,14*rs)}]}>Luck {dispLuck}%</Text>}
            <Animated.View style={{transform:[{translateX:diceAnim}]}}><DiceFace value={diceValue} style={S.diceFace}/></Animated.View>
            {diceValue ? <Text style={{color:"#00c781",fontSize:Math.max(16,20*rs),fontWeight:"bold"}}>Rolled {diceValue}!</Text>
            : <Pressable style={({hovered,pressed})=>[S.rollBtn, Platform.OS==='web'&&hovered&&{backgroundColor:'#00e090',transform:[{scale:1.06}]}, pressed&&{opacity:0.8}]} onPress={handleRoll}><Text style={S.rollTxtBig}>Roll!</Text></Pressable>}
          </View>
        )}

        {phase==="space_roll" && srType && (
          <View style={S.diceBox}>
            <Text style={{color:srType==="lava"?"#e74c3c":"#3498db",fontSize:Math.max(16,22*rs),fontWeight:"bold",textAlign:"center"}}>{srType==="lava"?"LAVA!":"CANNON!"}</Text>
            <Text style={[S.luckTxt,{fontSize:Math.max(11,13*rs),textAlign:"center",paddingHorizontal:16}]}>{srType==="lava"?"Roll to see how far you're pushed BACK":"Roll to see how far you're LAUNCHED forward"}</Text>
            <Animated.View style={{transform:[{translateX:srAnim}]}}><DiceFace value={srValue} style={S.diceFace}/></Animated.View>
            {srValue ? <Text style={{color:srType==="lava"?"#e74c3c":"#3498db",fontSize:Math.max(16,20*rs),fontWeight:"bold"}}>{srType==="lava"?`Back ${srValue} spaces!`:`Forward ${srValue} spaces!`}</Text>
            : <Pressable style={({hovered,pressed})=>[S.rollBtn,{backgroundColor:srType==="lava"?"#c0392b":"#2980b9"}, Platform.OS==='web'&&hovered&&{transform:[{scale:1.06}],opacity:0.9}, pressed&&{opacity:0.8}]} onPress={handleSpaceRoll} disabled={srRolling}><Text style={S.rollTxtBig}>{srRolling?"Rolling…":"Roll!"}</Text></Pressable>}
          </View>
        )}

        {phase==="moving" && <View style={S.movingBox}><ActivityIndicator color="#00c781" size="large"/><Text style={S.movingTxt}>Moving…</Text></View>}

        {phase==="rolled" && (
          <View style={S.diceBox}>
            <Text style={{color:"#00c781",fontSize:Math.max(16,20*rs),fontWeight:"900"}}>DONE</Text>
            <Text style={{color:"#fff",fontSize:Math.max(16,20*rs),fontWeight:"bold"}}>Move done!</Text>
            <Pressable style={({hovered,pressed})=>[S.rollBtn,{backgroundColor:"#00c781"}, Platform.OS==='web'&&hovered&&{backgroundColor:'#00e090',transform:[{scale:1.06}]}, pressed&&{opacity:0.8}]}
              onPress={()=>{ setPhaseSync("questions"); setQIdx(i=>i+1); }}>
              <Text style={S.rollTxtBig}>Back to Questions</Text>
            </Pressable>
          </View>
        )}

        {phase==="duel" && activeDuel && (
          <ScrollView contentContainerStyle={S.duelScroll}>
            <Text style={[S.mysteryBigTtl,{color:"#3498db"}]}>1v1 Duel!</Text>
            <Text style={[S.luckTxt,{fontSize:15,marginBottom:8}]}>
              <Text style={{color:activeDuel.challengerColor||"#fff"}}>{activeDuel.challengerName}</Text>
              {" vs "}
              <Text style={{color:activeDuel.opponentColor||"#fff"}}>{activeDuel.opponentName}</Text>
            </Text>
            {duelView==="active" && (() => {
              const r = activeDuel.currentRound;
              const isChallenger = activeDuel.challengerUid===playerUid||activeDuel.challengerName===playerName;
              const myKey = isChallenger?`c_${r}`:`o_${r}`;
              const alreadyAnswered = activeDuel[myKey] !== null;
              const q = activeDuel.questions?.[r];
              const cC=[activeDuel.c_0,activeDuel.c_1,activeDuel.c_2].filter(a=>a?.correct).length;
              const oC=[activeDuel.o_0,activeDuel.o_1,activeDuel.o_2].filter(a=>a?.correct).length;
              return (
                <>
                  <Text style={[S.luckTxt,{fontSize:13,marginBottom:8}]}>Round {r+1}/3 • {activeDuel.challengerName} {cC} – {oC} {activeDuel.opponentName}</Text>
                  {alreadyAnswered||duelAnswered ? (
                    <View style={S.waitBox}><ActivityIndicator color="#3498db"/><Text style={S.waitTxt}>Waiting for opponent…</Text></View>
                  ) : q ? (
                    <View style={S.qCard}>
                      {q.imageUrl?<TouchableOpacity onPress={()=>setZoomImage(q.imageUrl)} activeOpacity={0.85}><Image source={{uri:q.imageUrl}} style={S.qImage} resizeMode="contain"/><Text style={S.zoomHint}>Tap to zoom</Text></TouchableOpacity>:null}
                      <Text style={[S.qTxt,{fontSize:22}]}>{q.question}</Text>
                      {q.type==="multiSelect" ? (
                        <>
                          <Text style={{color:"#888",fontSize:13,marginBottom:6,textAlign:"center"}}>Select ALL correct answers, then tap Confirm</Text>
                          <View style={S.aGrid}>
                            {q.answers.map((ans,i) => {
                              const isSel = duelMultiSel.includes(i);
                              return (
                                <TouchableOpacity key={i}
                                  style={[S.aBtn,{backgroundColor:isSel?"#001d33":"#1c1c1c",borderColor:isSel?"#3498db":"#383838",flexDirection:"row",alignItems:"center"}]}
                                  onPress={()=>handleDuelMultiToggle(i)} disabled={duelMultiSubmitted} activeOpacity={0.75}>
                                  <View style={{width:28,alignItems:"center"}}>
                                    <Text style={{fontSize:18,color:isSel?"#3498db":"#444"}}>{isSel?"☑":"☐"}</Text>
                                  </View>
                                  <Text style={[S.aTxt,{flex:1,textAlign:"left"}]}>{ans}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                          <TouchableOpacity
                            style={[S.rollBtn,{backgroundColor:"#3498db",marginTop:12,alignSelf:"center",opacity:!duelMultiSubmitted&&duelMultiSel.length>0?1:0}]}
                            onPress={handleDuelMultiConfirm}
                            disabled={duelMultiSubmitted||duelMultiSel.length===0}>
                            <Text style={S.rollTxtBig}>Confirm</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <View style={S.aGrid}>
                          {(q.type==="multipleChoice"?q.answers:["True","False"]).map((ans,i)=>(
                            <Pressable key={i} style={({hovered,pressed})=>[S.aBtn,{backgroundColor:"#1c1c1c",borderColor:"#383838"}, Platform.OS==='web'&&hovered&&{transform:[{scale:1.02}],borderColor:'#5a9fd4'}, pressed&&{opacity:0.8}]} onPress={()=>handleDuelAnswer(i)}><Text style={S.aTxt}>{ans}</Text></Pressable>
                          ))}
                        </View>
                      )}
                    </View>
                  ) : <View style={S.waitBox}><ActivityIndicator color="#3498db"/></View>}
                </>
              );
            })()}
            {duelView==="done" && (() => {
              const iWon=activeDuel.winnerName===playerName, isTie=activeDuel.winnerName==="tie";
              const isChallenger=activeDuel.challengerName===playerName||activeDuel.challengerUid===playerUid;
              const otherName=isChallenger?activeDuel.opponentName:activeDuel.challengerName;
              const opp=(players||[]).find(p=>p.name===otherName);
              const myP=myState?.position||0, oppP=opp?.position||0;
              const swaps=iWon&&myP<oppP;
              const cC=[activeDuel.c_0,activeDuel.c_1,activeDuel.c_2].filter(a=>a?.correct).length;
              const oC=[activeDuel.o_0,activeDuel.o_1,activeDuel.o_2].filter(a=>a?.correct).length;
              const cT=([activeDuel.c_0,activeDuel.c_1,activeDuel.c_2].reduce((s,a)=>s+(a?.timeSec||0),0)/3).toFixed(1);
              const oT=([activeDuel.o_0,activeDuel.o_1,activeDuel.o_2].reduce((s,a)=>s+(a?.timeSec||0),0)/3).toFixed(1);
              return (
                <View style={[S.mysteryCard,{borderColor:isTie?"#aaa":iWon?"#2ecc71":"#e74c3c",width:"100%"}]}>
                  <Text style={S.mysteryEmoji}>{isTie?"🤝":iWon?"🏆":"💀"}</Text>
                  <Text style={[S.mysteryTitle,{color:isTie?"#aaa":iWon?"#2ecc71":"#e74c3c"}]}>{isTie?"Tie!":iWon?"You Win!":"You Lose!"}</Text>
                  <Text style={[S.luckTxt,{fontSize:14,marginTop:4}]}>{activeDuel.challengerName}: {cC}/3 • avg {cT}s</Text>
                  <Text style={[S.luckTxt,{fontSize:14}]}>{activeDuel.opponentName}: {oC}/3 • avg {oT}s</Text>
                  {iWon&&<Text style={[S.mysteryDesc,{marginTop:6}]}>{swaps?"Swapping positions!":"Already ahead — no swap needed."}</Text>}
                  {!iWon&&!isTie&&<Text style={[S.mysteryDesc,{marginTop:6}]}>Your opponent takes your position.</Text>}
                  <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#3498db",marginTop:12}]} onPress={dismissDuel}><Text style={S.rollTxtBig}>Continue</Text></TouchableOpacity>
                </View>
              );
            })()}
          </ScrollView>
        )}
      </View>

      {/* Hotbar */}
      {!isSolo && <View style={S.hotbar}>
        {[0,1,2].map(i => {
          const item = inventory[i];
          const def  = item ? INVENTORY_DEFS[item.type] : null;
          const borderC = item ? (item.type==="deflector"?"#00bcd4":"#f39c12") : "#333";
          return (
            <TouchableOpacity key={i} style={[S.hotbarSlot, item&&S.hotbarSlotFull, {borderColor:borderC}]} onPress={()=>item&&useInventoryItem(item)} activeOpacity={0.75}>
              {item ? (<><Text style={S.hotbarEmoji}>{def?.emoji}</Text><Text style={S.hotbarLabel} numberOfLines={2}>{def?.label}</Text></>) : <Text style={S.hotbarEmpty}>—</Text>}
            </TouchableOpacity>
          );
        })}
        <Text style={S.hotbarHint}>TAP{"\n"}TO{"\n"}USE</Text>
      </View>}

      {/* Mystery box */}
      <Modal visible={mBoxOpen} transparent animationType="fade">
        <View style={S.mysteryOverlay}>
          <View style={S.mysteryPanel}>
            {/* X closes — restores item only if effect not yet revealed */}
            <CloseBtn onPress={()=>closeMBox(mBoxStep)}/>
            <Text style={S.mysteryBigTtl}> Mystery Box!</Text>
            {mBoxStep==="roll" && (
              <>
                <Text style={S.luckTxt}>Roll to reveal your effect…</Text>
                <Animated.View style={{transform:[{translateX:mBoxAnim}]}}><DiceFace value={null} style={[S.diceFace,{fontSize:72}]}/></Animated.View>
                <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#8e44ad"}]} onPress={handleMBoxRoll} disabled={mBoxRolling}>
                  <Text style={S.rollTxtBig}>{mBoxRolling?"Rolling…":"Open Box!"}</Text>
                </TouchableOpacity>
              </>
            )}
            {(mBoxStep==="apply"||mBoxStep==="inventory") && mBoxDef && (
              <View style={[S.mysteryCard,{borderColor:mBoxDef.color}]}>
                <Text style={S.mysteryEmoji}>{mBoxDef.emoji}</Text>
                <Text style={[S.mysteryTitle,{color:mBoxDef.color}]}>{mBoxDef.title}</Text>
                <Text style={S.mysteryDesc}>{mBoxStep==="inventory"?"Added to your inventory!":mBoxDef.desc}</Text>
                <TouchableOpacity style={[S.rollBtn,{backgroundColor:mBoxDef.color,marginTop:12}]} onPress={claimMBoxNoTarget}>
                  <Text style={S.rollTxtBig}>{mBoxStep==="inventory"?"Save to Inventory":"Use It!"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#444",marginTop:8}]} onPress={()=>closeMBox("decline")}>
                  <Text style={[S.rollTxtBig,{color:"#bbb"}]}>Decline</Text>
                </TouchableOpacity>
              </View>
            )}
            {mBoxStep==="target" && mBoxDef && (
              <>
                <View style={[S.mysteryCard,{borderColor:mBoxDef.color}]}>
                  <Text style={S.mysteryEmoji}>{mBoxDef.emoji}</Text>
                  <Text style={[S.mysteryTitle,{color:mBoxDef.color}]}>{mBoxDef.title}</Text>
                  <Text style={S.mysteryDesc}>{mBoxDef.desc}</Text>
                </View>
                <Text style={[S.luckTxt,{marginTop:14,fontSize:16}]}>Choose a player:</Text>
                {otherPs.map(p=>(
                  <TouchableOpacity key={p.name} style={[S.targetBtn,{borderColor:p.color||"#888"}]} onPress={()=>claimMBoxTarget(p)}>
                    <Pawn color={p.color||"#888"} size={22}/>
                    <View style={{width:8}}/>
                    <Text style={[S.targetName,{color:p.color||"#fff"}]}>{p.name}</Text>
                    <Text style={S.targetPos}>Space {p.position||0}</Text>
                  </TouchableOpacity>
                ))}
                {otherPs.length===0
                  // No targets available — restore the box (not the player's fault)
                  ? <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#555",marginTop:12}]} onPress={()=>closeMBox("roll")}><Text style={S.rollTxtBig}>No players — Close</Text></TouchableOpacity>
                  : <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#444",marginTop:10}]} onPress={()=>closeMBox("decline")}><Text style={[S.rollTxtBig,{color:"#bbb"}]}>Decline</Text></TouchableOpacity>
                }
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Inventory full */}
      <Modal visible={!!invFullItem} transparent animationType="fade">
        <View style={S.overlay}><View style={S.modal}>
          <CloseBtn onPress={()=>setInvFullItem(null)}/>
          <Text style={S.mTtl}>Inventory Full!</Text>
          <Text style={S.mDesc}>Discard an item to make room, or lose the new one.</Text>
          {inventory.map(item=>{
            const def=INVENTORY_DEFS[item.type];
            return (
              <TouchableOpacity key={item.id} style={[S.targetBtn,{width:"100%",marginVertical:4}]} onPress={()=>{removeFromInventory(item.id);setInventory(p=>[...p,{type:invFullItem.type,id:Date.now()}]);showItemToast(invFullItem.type,invFullItem.reason);setInvFullItem(null);}}>
                <Text style={{fontSize:22,marginRight:8}}>{def?.emoji}</Text>
                <Text style={{color:"#fff",flex:1}}>{def?.label}</Text>
                <Text style={{color:"#e74c3c"}}>Discard</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#333",marginTop:6}]} onPress={()=>setInvFullItem(null)}><Text style={S.rollTxtBig}>Lose Item</Text></TouchableOpacity>
        </View></View>
      </Modal>

      {/* STUN MODAL — 1v1 takes priority: hidden during duel and countdown */}
      <Modal visible={isStunned && phase !== "duel" && duelCountdown === null} transparent animationType="fade">
        <View style={[S.overlay, {backgroundColor:"rgba(160,80,0,0.97)"}]}>
          <View style={[S.modal, {borderColor:"#f39c12",borderWidth:2.5,backgroundColor:"#2e1500",width:"92%",maxWidth:480}]}>
            
            <Text style={[S.mTtl,{color:"#ffa500",fontSize:32,letterSpacing:2}]}>STUNNED!</Text>
            {stunBy ? <Text style={[S.mDesc,{color:"#ffcc88",fontSize:14,marginTop:-4}]}>by {stunBy}</Text> : null}
            <Text style={[S.mDesc,{color:"#ffe0a0",fontSize:18,fontWeight:"700"}]}>Answer {ROLL_AT} questions in a row to break free!</Text>
            <View style={{flexDirection:"row",gap:12,marginVertical:8}}>
              {[0,1,2].map(i=>(
                <View key={i} style={[S.rollDot, i<stunRecovery && {backgroundColor:"#f39c12",borderColor:"#f39c12",width:20,height:20,borderRadius:10}]}/>
              ))}
              <Text style={{color:"#ffcc88",fontSize:14,marginLeft:4}}>{stunRecovery}/{ROLL_AT}</Text>
            </View>
            {(() => {
              if (!qList.length) return <ActivityIndicator color="#f39c12"/>;
              const sq = qList[stunQIdx % qList.length];
              if (!sq) return <ActivityIndicator color="#f39c12"/>;
              return (
                <View style={{width:"100%",gap:12}}>
                  {sq.imageUrl ? <TouchableOpacity onPress={()=>setZoomImage(sq.imageUrl)} activeOpacity={0.85}><Image source={{uri:sq.imageUrl}} style={[S.qImage,{height:140}]} resizeMode="contain"/><Text style={S.zoomHint}>Tap to zoom</Text></TouchableOpacity> : null}
                  <Text style={[S.qTxt,{fontSize:22,color:"#fff",marginBottom:4}]}>{sq.question}</Text>
                  {sq.type === "multiSelect" ? (
                    <>
                      <Text style={{color:"#ffcc88",fontSize:12,textAlign:"center",marginBottom:6}}>Select ALL correct answers, then tap Confirm</Text>
                      {sq.answers.map((ans,i) => {
                        const isSel = stunMultiSel.includes(i);
                        const isCorr = sq.correctAnswers?.[i]===true;
                        let bg="#3d2000", bc="#6b3a00";
                        if(stunSelAns!=null&&isCorr){bg="#003d1a";bc="#00c781";}
                        if(stunSelAns!=null&&isSel&&!isCorr){bg="#3d0000";bc="#e74c3c";}
                        if(stunSelAns===null&&isSel){bg="#002244";bc="#3498db";}
                        return (
                          <TouchableOpacity key={i} style={[S.aBtn,{backgroundColor:bg,borderColor:bc,flexDirection:"row",alignItems:"center"}]}
                            onPress={()=>handleStunMultiToggle(i)} disabled={stunSelAns!==null} activeOpacity={0.75}>
                            <View style={{width:28,alignItems:"center"}}>
                              <Text style={{fontSize:18,color:isSel?"#3498db":"#666"}}>{isSel?"☑":"☐"}</Text>
                            </View>
                            <Text style={[S.aTxt,{flex:1,textAlign:"left"}]}>{ans}</Text>
                          </TouchableOpacity>
                        );
                      })}
                      <TouchableOpacity
                        style={[S.rollBtn,{backgroundColor:"#f39c12",marginTop:10,alignSelf:"center",opacity:stunSelAns===null&&stunMultiSel.length>0?1:0}]}
                        onPress={handleStunMultiConfirm}
                        disabled={stunSelAns!==null||stunMultiSel.length===0}>
                        <Text style={S.rollTxtBig}>Confirm</Text>
                      </TouchableOpacity>
                    </>
                  ) : (sq.type==="multipleChoice" ? sq.answers : ["True","False"]).map((ans,i) => {
                    const isSel=stunSelAns===i, isCorr=sq.correctAnswers?.[i]===true;
                    let bg="#3d2000", bc="#6b3a00";
                    if(isSel){bg=isCorr?"#003d1a":"#3d0000";bc=isCorr?"#00c781":"#e74c3c";}
                    else if(stunSelAns!==null&&isCorr){bg="#003d1a";bc="#00c781";}
                    return (
                      <TouchableOpacity key={i} style={[S.aBtn,{backgroundColor:bg,borderColor:bc}]}
                        onPress={()=>handleStunAnswer(i)} disabled={stunSelAns!==null} activeOpacity={0.75}>
                        <Text style={S.aTxt}>{ans}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Duel countdown — multiplayer only */}
      {!isSolo && <Modal visible={duelCountdown !== null} transparent animationType="fade">
        <View style={[S.overlay,{backgroundColor:"rgba(0,10,30,0.97)"}]}>
          <View style={[S.modal,{borderColor:"#3498db",borderWidth:3,backgroundColor:"#060e1e",
            shadowColor:"#3498db",shadowOffset:{width:0,height:0},shadowOpacity:0.7,shadowRadius:28}]}>
          
          <Text style={[S.mTtl,{color:"#60c8ff",fontSize:30}]}>1v1 Starting!</Text>
          <Text style={{color:"#fff",fontSize:100,fontWeight:"900",textAlign:"center",lineHeight:110}}>{duelCountdown}</Text>
          <Text style={[S.mDesc,{color:"#88ccff",fontSize:18}]}>Get ready…</Text>
          </View>
        </View>
      </Modal>}

      {/* Effect notification — multiplayer only */}
      {!isSolo && <Modal visible={showNotif && duelCountdown === null} transparent animationType="fade">
        <View style={[S.overlay,{backgroundColor:"rgba(20,8,0,0.97)"}]}>
          <View style={[S.modal,{borderColor:"#f39c12",borderWidth:3,backgroundColor:"#1e1000",
            shadowColor:"#f39c12",shadowOffset:{width:0,height:0},shadowOpacity:0.7,shadowRadius:28}]}>
          <CloseBtn onPress={()=>{ setShowNotif(false); if(interruptedPhase){setPhaseSync(interruptedPhase);setInterruptedPhase(null);} }}/>
          <Text style={{fontSize:52}}></Text>
          <Text style={[S.mTtl,{color:"#ffa500",fontSize:28}]}>Effect Applied!</Text>
          <Text style={[S.mDesc,{fontSize:20,lineHeight:30,color:"#ffe0b0",fontWeight:"600"}]}>{notif}</Text>
          <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#e67e22",marginTop:8,paddingVertical:18,paddingHorizontal:52}]} onPress={()=>{ setShowNotif(false); if(interruptedPhase){setPhaseSync(interruptedPhase);setInterruptedPhase(null);} }}><Text style={[S.rollTxtBig,{fontSize:22}]}>Got it</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>}

      {/* Trap */}
      <Modal visible={phase==="space_event" && !!trapEvent} transparent animationType="fade">
        <View style={[S.overlay,{backgroundColor:"rgba(10,6,0,0.97)"}]}>
          <View style={[S.modal,{borderColor:"#d68910",borderWidth:3,backgroundColor:"#1a1200",
            shadowColor:"#d68910",shadowOffset:{width:0,height:0},shadowOpacity:0.6,shadowRadius:20}]}>
          <CloseBtn onPress={()=>{ clearInterval(trapRef.current); setTrapEvent(null); setPhaseSync("questions"); setDiceValue(null); }}/>
          <Text style={[S.mTtl,{color:"#d68910"}]}>Trap — Answer Fast!</Text>
          <Text style={[{color:"#fff",fontSize:40,fontWeight:"bold",textAlign:"center"},trapTimer<=3&&{color:"#e74c3c"}]}>{trapTimer}s</Text>
          {trapEvent?.question && (
            <>
              {trapEvent.question.imageUrl?<TouchableOpacity onPress={()=>setZoomImage(trapEvent.question.imageUrl)} activeOpacity={0.85}><Image source={{uri:trapEvent.question.imageUrl}} style={[S.qImage,{height:120}]} resizeMode="contain"/><Text style={S.zoomHint}>Tap to zoom</Text></TouchableOpacity>:null}
              <Text style={S.mDesc}>{trapEvent.question.question}</Text>
              {trapEvent.question.type==="multiSelect" ? (
                <>
                  <Text style={{color:"#888",fontSize:12,textAlign:"center",marginBottom:4}}>Select ALL correct, then Confirm</Text>
                  <View style={S.aGrid}>
                    {trapEvent.question.answers.map((ans,i) => {
                      const isSel = trapMultiSel.includes(i);
                      return (
                        <TouchableOpacity key={i}
                          style={[S.aBtn,{borderColor:isSel?"#d68910":"#555",backgroundColor:isSel?"#2a1800":"#1c1c1c",flexDirection:"row",alignItems:"center"}]}
                          disabled={trapMultiDone||trapAnswered}
                          onPress={()=>{ if(trapMultiDone||trapAnswered) return; setTrapMultiSel(prev=>prev.includes(i)?prev.filter(x=>x!==i):[...prev,i]); }}
                          activeOpacity={0.75}>
                          <View style={{width:28,alignItems:"center"}}>
                            <Text style={{fontSize:18,color:isSel?"#d68910":"#555"}}>{isSel?"☑":"☐"}</Text>
                          </View>
                          <Text style={[S.aTxt,{flex:1,textAlign:"left"}]}>{ans}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TouchableOpacity
                    style={[S.rollBtn,{backgroundColor:"#d68910",marginTop:10,alignSelf:"center",opacity:(!trapMultiDone&&!trapAnswered&&trapMultiSel.length>0)?1:0.3}]}
                    disabled={trapMultiDone||trapAnswered||trapMultiSel.length===0}
                    onPress={()=>{
                      clearInterval(trapRef.current);
                      setTrapMultiDone(true); setTrapAnswered(true);
                      const q = trapEvent.question;
                      const correctIdxs = (q.correctAnswers||[]).map((v,i)=>v?i:null).filter(x=>x!==null);
                      const selected = [...trapMultiSel].sort((a,b)=>a-b);
                      const sortedCorrect = [...correctIdxs].sort((a,b)=>a-b);
                      const correct = selected.length===sortedCorrect.length && selected.every((v,i)=>v===sortedCorrect[i]);
                      resolveEvent({correct});
                    }}>
                    <Text style={S.rollTxtBig}>Confirm</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={S.aGrid}>
                  {(trapEvent.question.type==="multipleChoice"?trapEvent.question.answers:["True","False"]).map((ans,i)=>(
                    <TouchableOpacity key={i} style={[S.aBtn,{borderColor:"#555"}]} disabled={trapAnswered}
                      onPress={()=>{ clearInterval(trapRef.current); setTrapAnswered(true); resolveEvent({correct:trapEvent.question.correctAnswers?.[i]===true}); }}>
                      <Text style={S.aTxt}>{ans}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}
        </View></View>
      </Modal>

      {/* Game over */}
      {session?.status==="ended" && !gameOverDone && <GameOverModal session={session} myPos={myPos} boardEnd={boardEnd} onExit={()=>{ setGameOverDone(true); exitGame(); }}/>}

      <Modal visible={!!(myState&&(session?.kickedPlayers||[]).includes(playerName))} transparent animationType="fade">
        <View style={S.overlay}><View style={S.modal}><Text style={S.mTtl}>You've Been Kicked</Text><Text style={S.mDesc}>The host removed you.</Text><TouchableOpacity style={[S.rollBtn,{backgroundColor:"#00c781"}]} onPress={()=>navigation.reset({index:0,routes:[{name:"JoinGameScreen"}]})}><Text style={S.rollTxtBig}>Back</Text></TouchableOpacity></View></View>
      </Modal>
      <Modal visible={session?.status==="abandoned" && (!isHost||hostIsPlaying)} transparent animationType="fade">
        <View style={S.overlay}><View style={S.modal}><Text style={S.mTtl}>Game Ended</Text><Text style={S.mDesc}>The host ended the game.</Text><TouchableOpacity style={[S.rollBtn,{backgroundColor:"#00c781"}]} onPress={()=>navigation.reset({index:0,routes:[{name:"JoinGameScreen"}]})}><Text style={S.rollTxtBig}>Back</Text></TouchableOpacity></View></View>
      </Modal>

      <Modal visible={!!zoomImage} transparent animationType="fade">
        <TouchableOpacity style={S.zoomOverlay} activeOpacity={1} onPress={()=>setZoomImage(null)}>
          <Image source={{uri:zoomImage||""}} style={S.zoomImg} resizeMode="contain"/>
          <Text style={S.zoomClose}>Tap anywhere to close</Text>
        </TouchableOpacity>
      </Modal>

      {flashData && (
        <Animated.View style={[S.flashOverlay, {opacity: flashOpacity}]}>
          <View style={[S.flashBg, {backgroundColor: flashData.isCorrect ? "#27ae60" : "#c0392b"}]}/>
          <View style={S.flashContent}>
            <Text style={S.flashTtl}>{flashData.isCorrect ? "CORRECT" : "INCORRECT"}</Text>
            {!flashData.isCorrect && showCA && flashData.text ? (
              <><Text style={S.flashSubLbl}>Correct answer</Text><Text style={S.flashSubTxt}>"{flashData.text}"</Text></>
            ) : null}
          </View>
        </Animated.View>
      )}

      {itemToast && (
        <Animated.View style={[S.toast,{opacity:toastAnim,transform:[{translateY:toastAnim.interpolate({inputRange:[0,1],outputRange:[-60,0]})}]}]}>
          <Text style={S.toastTxt}>{itemToast.emoji} {itemToast.text}</Text>
        </Animated.View>
      )}

      {/* Leave confirmation modal — PLAYER VIEW */}
      <Modal visible={showLeave} transparent animationType="fade">
        <View style={S.mOverlay}>
          <View style={S.mBox}>
            <Text style={S.mTtl}>Leave Game?</Text>
            <Text style={S.mDesc}>Are you sure you want to leave?</Text>
            <View style={{flexDirection:"row",gap:12,marginTop:16}}>
              <TouchableOpacity style={[S.rollBtn,{flex:1,backgroundColor:"#00c781"}]} onPress={()=>setShowLeave(false)}>
                <Text style={S.rollTxtBig}>Stay</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.rollBtn,{flex:1,backgroundColor:"#c0392b"}]} onPress={()=>{setShowLeave(false);exitGame();}}>
                <Text style={S.rollTxtBig}>Leave</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

function GameOverModal({ session, myPos, boardEnd, onExit }) {
  const players = session?.players || [];
  const gameStarted = session?.gameEndsAt ? session.gameEndsAt - ((session?.settings?.gameDuration||10)*60*1000) : null;

  // Sort: highest position first; ties broken by earliest finishedAt
  const sorted = [...players].sort((a,b) => {
    const posDiff = (b.position||0) - (a.position||0);
    if (posDiff !== 0) return posDiff;
    // Both reached the end — earlier finish time wins
    if (a.finishedAt && b.finishedAt) return a.finishedAt - b.finishedAt;
    if (a.finishedAt) return -1;
    if (b.finishedAt) return 1;
    return 0;
  });
  const w = sorted[0];

  const formatFinish = (p) => {
    if (!p.finishedAt || p.position < boardEnd) return null;
    if (!gameStarted) return null;
    const ms = p.finishedAt - gameStarted;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    const msec = ms % 1000;
    if (mins > 0) return `${mins}m ${secs}.${String(msec).padStart(3,'0')}s`;
    return `${secs}.${String(msec).padStart(3,'0')}s`;
  };

  return (
    <Modal visible transparent animationType="fade">
      <View style={S.overlay}><View style={S.modal}>
        <Text style={S.mTtl}>Game Over!</Text>
        {w&&<Text style={[S.mDesc,{fontSize:20}]}>🏆 <Text style={{color:w.color||"#00c781",fontWeight:"bold"}}>{w.name}</Text> wins! Space {w.position}</Text>}
        {myPos>=0&&<Text style={[S.mDesc,{color:"#666"}]}>You reached space {myPos}/{boardEnd}</Text>}
        <View style={{width:"100%",marginVertical:12}}>
          {sorted.slice(0,10).map((p,i)=>{
            const finishStr = formatFinish(p);
            // Check if this player ties with the one above on position
            const prevP = sorted[i-1];
            const isTie = prevP && (p.position||0) === (p.position>=boardEnd ? boardEnd : (p.position||0)) && (prevP.position||0) === (p.position||0) && (p.position||0) >= boardEnd;
            return (
              <View key={p.name||i} style={S.lbRow}>
                <Text style={S.lbRank}>#{i+1}</Text>
                <Pawn color={p.color||"#888"} size={22}/>
                <View style={{width:8}}/>
                <View style={{flex:1}}>
                  <Text style={S.lbName} numberOfLines={1}>{p.name}</Text>
                  {finishStr && <Text style={{color:"#888",fontSize:12,marginTop:1}}>⏱ {finishStr}</Text>}
                </View>
                <Text style={S.lbPos}>{p.position||0}/{boardEnd}</Text>
              </View>
            );
          })}
        </View>
        <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#00c781"}]} onPress={onExit}><Text style={S.rollTxtBig}>Back to Menu</Text></TouchableOpacity>
      </View></View>
    </Modal>
  );
}

const S = StyleSheet.create({
  container:        { flex:1, backgroundColor:"#111" },
  containerStunned: { backgroundColor:"#2e200a" },
  center:           { flex:1, backgroundColor:"#111", justifyContent:"center", alignItems:"center" },
  hud:        { flexDirection:"row", alignItems:"center", backgroundColor:"#0a0a0a", borderBottomWidth:2, borderBottomColor:"#222", paddingVertical:8, paddingHorizontal:8, flexWrap:"wrap", gap:4 },
  hudStunned: { backgroundColor:"#3d2806" },
  hudCell:    { alignItems:"center", paddingHorizontal:6, minWidth:44 },
  hudLbl:     { color:"#555", fontSize:10, letterSpacing:0.8, fontWeight:"700" },
  hudVal:     { color:"#fff", fontSize:18, fontWeight:"bold", marginTop:2 },
  qBtn:       { paddingHorizontal:10, paddingVertical:8, borderRadius:10, backgroundColor:"#1a1a1a", borderWidth:1.5, borderColor:"#555" },
  qBtnActive: { backgroundColor:"#002200", borderColor:"#00c781" },
  qBtnTxt:    { color:"#aaa", fontSize:11, fontWeight:"700" },
  mapBtn:     { paddingHorizontal:10, paddingVertical:8, borderRadius:10, backgroundColor:"#1a1a1a", borderWidth:1.5, borderColor:"#333" },
  mapBtnOn:   { backgroundColor:"#002a1a", borderColor:"#00c781" },
  mapBtnTxt:  { color:"#aaa", fontSize:12, fontWeight:"700" },
  hudEndBtn:  { paddingHorizontal:16, paddingVertical:14, borderRadius:14, backgroundColor:"#3a0000", borderWidth:1.5, borderColor:"#c0392b" },
  hudEndBtnTxt:{ color:"#ff6b6b", fontSize:16, fontWeight:"700" },
  timerTrack: { width:"100%", height:7, backgroundColor:"#1a1a1a" },
  timerFill:  { height:7, backgroundColor:"#00c781", alignSelf:"flex-start" },
  main: { flex:1, flexDirection:"column" },
  qScroll:    { flexGrow:1, justifyContent:"center", padding:12, paddingBottom:80 },
  qCard:      { gap:10 },
  rollBar:    { flexDirection:"row", alignItems:"center", justifyContent:"center", gap:10, marginBottom:14 },
  rollDot:    { width:16, height:16, borderRadius:8, backgroundColor:"#2a2a2a", borderWidth:2, borderColor:"#444" },
  rollDotOn:  { backgroundColor:"#00c781", borderColor:"#00c781" },
  rollTxt2:   { color:"#555", fontSize:13, marginLeft:4 },
  qImage:     { width:"100%", height:200, borderRadius:12, marginBottom:4, backgroundColor:"#1e1e1e" },
  zoomHint:   { color:"#555", fontSize:11, textAlign:"center", marginBottom:12 },
  zoomOverlay:{ flex:1, backgroundColor:"rgba(0,0,0,0.95)", justifyContent:"center", alignItems:"center" },
  zoomImg:    { width:"100%", height:"80%", borderRadius:8 },
  zoomClose:  { color:"#666", fontSize:14, marginTop:16 },
  qTxt:       { color:"#fff", fontSize:18, fontWeight:"700", lineHeight:26, textAlign:"center" },
  aGrid:      { gap:8 },
  aBtn:       { borderRadius:10, paddingVertical:11, paddingHorizontal:12, borderWidth:2, alignItems:"center" },
  aTxt:       { color:"#fff", fontSize:15, fontWeight:"600" },
  waitBox:    { alignItems:"center", paddingVertical:80, gap:14 },
  waitTxt:    { color:"#555", fontSize:16 },
  legend:     { flexDirection:"row", flexWrap:"wrap", justifyContent:"center", gap:10, paddingVertical:10 },
  legendItem: { flexDirection:"row", alignItems:"center", gap:5 },
  legendSwatch:{ width:16, height:16, borderRadius:3, borderWidth:1.5 },
  legendTxt:  { fontSize:12, fontWeight:"600" },
  diceBox:    { alignItems:"center", justifyContent:"center", gap:8, backgroundColor:"#111", paddingVertical:12, paddingHorizontal:20, paddingBottom:84 },
  diceTtl:    { color:"#fff", fontSize:26, fontWeight:"bold", textAlign:"center" },
  luckTxt:    { color:"#888", fontSize:13, textAlign:"center" },
  diceFace:   { fontSize:72, color:"#fff" },
  diceRes:    { color:"#00c781", fontSize:24, fontWeight:"bold" },
  rollBtn:    { backgroundColor:"#00c781", paddingVertical:13, paddingHorizontal:32, borderRadius:14 },
  rollTxtBig: { color:"#000", fontSize:17, fontWeight:"bold" },
  movingBox:  { alignItems:"center", justifyContent:"center", gap:16, backgroundColor:"#0d0d0d", paddingVertical:20 },
  movingTxt:  { color:"#aaa", fontSize:18 },
  rolledBox:  { flex:1, alignItems:"center", justifyContent:"center", gap:16, backgroundColor:"#0d0d0d" },
  rolledEmoji:{ fontSize:64 },
  rolledTtl:  { color:"#fff", fontSize:26, fontWeight:"bold" },
  hotbar:     { position:"absolute", bottom:0, left:0, right:0, flexDirection:"row", alignItems:"center", justifyContent:"center", gap:6, paddingVertical:5, paddingHorizontal:8, paddingBottom:8, backgroundColor:"rgba(0,0,0,0.95)", borderTopWidth:1, borderTopColor:"#333" },
  hotbarSlot: { flex:1, maxWidth:100, height:46, borderRadius:10, backgroundColor:"#1a1a1a", borderWidth:1.5, borderColor:"#333", alignItems:"center", justifyContent:"center", flexDirection:"row", gap:4 },
  hotbarSlotFull: { backgroundColor:"#1e1a00" },
  hotbarEmoji:{ fontSize:18 },
  hotbarLabel:{ color:"#fff", fontSize:8, fontWeight:"700", textAlign:"center", paddingHorizontal:2, flexShrink:1 },
  hotbarEmpty:{ color:"#333", fontSize:22 },
  hotbarHint: { color:"#444", fontSize:8, fontWeight:"700", textAlign:"center", marginLeft:4 },
  mysteryOverlay: { flex:1, backgroundColor:"rgba(0,0,0,0.82)", justifyContent:"center", alignItems:"center" },
  mysteryPanel:   { backgroundColor:"#1a0830", borderRadius:24, borderWidth:3, borderColor:"#a855f7", padding:28, width:"92%", maxWidth:460, alignItems:"center", gap:14, position:"relative",
                    shadowColor:"#a855f7", shadowOffset:{width:0,height:0}, shadowOpacity:0.6, shadowRadius:24 },
  mysteryBigTtl:  { color:"#d8a0ff", fontSize:32, fontWeight:"900", textAlign:"center", letterSpacing:1 },
  mysteryCard:    { backgroundColor:"#22083a", borderRadius:20, borderWidth:2.5, padding:24, alignItems:"center", gap:10, width:"100%" },
  mysteryEmoji:   { fontSize:52 },
  mysteryTitle:   { fontSize:28, fontWeight:"900", textAlign:"center", letterSpacing:0.5 },
  mysteryDesc:    { color:"#ddd", fontSize:17, textAlign:"center", lineHeight:26 },
  targetBtn:      { flexDirection:"row", alignItems:"center", backgroundColor:"#252525", borderRadius:14, borderWidth:2, paddingVertical:16, paddingHorizontal:18, marginVertical:4 },
  targetName:     { flex:1, fontSize:19, fontWeight:"700" },
  targetPos:      { color:"#555", fontSize:14 },
  duelScroll:     { flexGrow:1, justifyContent:"flex-start", padding:16, paddingBottom:90, alignItems:"center", gap:10 },
  closeBtn:    { position:"absolute", top:10, right:10, width:36, height:36, borderRadius:18, backgroundColor:"rgba(255,255,255,0.18)", borderWidth:1, borderColor:"rgba(255,255,255,0.25)", alignItems:"center", justifyContent:"center", zIndex:10 },
  closeBtnTxt: { color:"#fff", fontSize:18, fontWeight:"bold" },
  toast:    { position:"absolute", bottom:24, right:100, backgroundColor:"#1a1a00", borderWidth:1.5, borderColor:"#f39c12", borderRadius:14, paddingVertical:10, paddingHorizontal:16, zIndex:998, maxWidth:260 },
  toastTxt: { color:"#f39c12", fontSize:13, fontWeight:"bold", lineHeight:18 },
  flashOverlay: { position:"absolute", top:0, left:0, right:0, bottom:0, zIndex:999 },
  flashBg:      { position:"absolute", top:0, left:0, right:0, bottom:0 },
  flashContent: { flex:1, justifyContent:"center", alignItems:"center" },
  flashTtl:     { color:"#fff", fontSize:72, fontWeight:"900", letterSpacing:2, textAlign:"center" },
  flashSubLbl:  { color:"rgba(255,255,255,0.85)", fontSize:22, marginTop:20 },
  flashSubTxt:  { color:"#fff", fontSize:28, fontWeight:"bold", textAlign:"center", paddingHorizontal:32 },
  hostHeader: { flexDirection:"row", justifyContent:"space-between", alignItems:"center", padding:18, backgroundColor:"#0a0a0a", borderBottomWidth:1, borderBottomColor:"#222" },
  hostTitle:  { color:"#00c781", fontSize:20, fontWeight:"bold" },
  timerTxt:   { color:"#fff", fontSize:18, fontWeight:"bold" },
  endBtn:     { backgroundColor:"#c0392b", paddingVertical:10, paddingHorizontal:22, borderRadius:12 },
  endBtnTxt:  { color:"#fff", fontWeight:"bold", fontSize:15 },
  hostBody:   { flex:1, flexDirection:"row" },
  hostSide:   { width:400, backgroundColor:"#0a0a0a", padding:20, borderLeftWidth:1, borderLeftColor:"#222" },
  lbTitle:    { color:"#00c781", fontSize:32, fontWeight:"bold", marginBottom:24 },
  lbRow:      { flexDirection:"row", alignItems:"center", paddingVertical:18, borderBottomWidth:1, borderBottomColor:"#1a1a1a" },
  lbRank:     { color:"#fff", width:60, fontSize:28, fontWeight:"bold" },
  lbDot:      { width:26, height:26, borderRadius:13, marginRight:16 },
  lbName:     { color:"#fff", fontSize:26, fontWeight:"500", flex:1 },
  lbPos:      { color:"#aaa", fontSize:24 },
  leaveBtn:    { position:"absolute", top:8, right:8, backgroundColor:"rgba(42,0,0,0.85)", paddingVertical:7, paddingHorizontal:14, borderRadius:10, zIndex:5 },
  leaveBtnTxt: { color:"#ff6b6b", fontSize:12, fontWeight:"bold" },
  overlay: { flex:1, backgroundColor:"rgba(0,0,0,0.94)", justifyContent:"center", alignItems:"center" },
  modal:   { backgroundColor:"#1e1e1e", borderRadius:24, padding:28, width:"92%", maxWidth:460, alignItems:"center", borderWidth:2.5, borderColor:"#444", gap:14, position:"relative",
             shadowColor:"#000", shadowOffset:{width:0,height:8}, shadowOpacity:0.8, shadowRadius:20 },
  mTtl:    { color:"#fff", fontSize:26, fontWeight:"900", textAlign:"center", letterSpacing:0.5 },
  mDesc:   { color:"#e0e0e0", fontSize:17, textAlign:"center", lineHeight:25 },
  stunnedBanner:{ backgroundColor:"#5c3800", borderRadius:10, padding:10, marginBottom:6, borderWidth:1.5, borderColor:"#d68910" },
  stunnedTxt:   { color:"#f39c12", fontSize:16, fontWeight:"bold", textAlign:"center" },
});