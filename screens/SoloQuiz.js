/**
 * SoloQuiz.js
 * Solo play — answer questions from the set, no board.
 * Supports multipleChoice, trueFalse, multiSelect.
 * Respects showAnswersAfter, randomizeQuestions, randomizeAnswers settings.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  ScrollView, Animated, useWindowDimensions, Modal, Image,
} from "react-native";

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDeck(questions, randomizeQ, randomizeA) {
  let deck = randomizeQ ? shuffle(questions) : [...questions];
  if (randomizeA) {
    deck = deck.map(q => {
      if (!q.answers?.length || q.type === 'trueFalse') return q;
      const paired = q.answers.map((a, i) => ({ a, c: q.correctAnswers?.[i] ?? false }));
      const shuffled = shuffle(paired);
      return { ...q, answers: shuffled.map(p => p.a), correctAnswers: shuffled.map(p => p.c) };
    });
  }
  return deck;
}

const GRADE_THRESHOLDS = [
  { min: 90, grade: 'A+', msg: 'Perfect!',        color: '#00c781' },
  { min: 80, grade: 'A',  msg: 'Excellent!',      color: '#00c781' },
  { min: 70, grade: 'B',  msg: 'Great work!',     color: '#27ae60' },
  { min: 60, grade: 'C',  msg: 'Good effort!',    color: '#f39c12' },
  { min: 50, grade: 'D',  msg: 'Keep practising!',color: '#e67e22' },
  { min: 0,  grade: 'F',  msg: 'Keep trying!',    color: '#e74c3c' },
];

export default function SoloQuiz({ navigation, route }) {
  const {
    questions = [],
    title = "",
    coverImage = null,
    timePerQuestion = 20,
    gameDuration = 10,
    showAnswersAfter = true,
    randomizeQuestions = true,
    randomizeAnswers = true,
  } = route.params || {};

  const { width: winW, height: winH } = useWindowDimensions();
  const rs = Math.min(1, Math.max(0.6, winW / 480, winH / 700));

  const deckRef = useRef(buildDeck(questions, randomizeQuestions, randomizeAnswers));

  const [qIdx,         setQIdx]         = useState(0);
  const [selAns,       setSelAns]       = useState(null);
  const [multiSel,     setMultiSel]     = useState([]);
  const [multiDone,    setMultiDone]    = useState(false);
  const [feedback,     setFeedback]     = useState(null);
  const [score,        setScore]        = useState(0);
  const [total,        setTotal]        = useState(0);
  const [streak,       setStreak]       = useState(0);
  const [bestStreak,   setBestStreak]   = useState(0);
  const [gameOver,     setGameOver]     = useState(false);
  const [qTimeLeft,    setQTimeLeft]    = useState(timePerQuestion);
  const [gameTimeLeft, setGameTimeLeft] = useState(gameDuration * 60);
  const [showQuitModal,setShowQuitModal]= useState(false);

  // Animated values
  const timerAnim   = useRef(new Animated.Value(1)).current;
  const feedbackAnim= useRef(new Animated.Value(0)).current;
  const qTimerRef   = useRef(null);
  const gameTimerRef= useRef(null);

  const deck = deckRef.current;
  const curQ = deck[qIdx % deck.length];
  const answers = curQ?.type === 'trueFalse' ? ['True', 'False'] : (curQ?.answers || []);

  const nextQuestion = useCallback(() => {
    setSelAns(null);
    setMultiSel([]);
    setMultiDone(false);
    setFeedback(null);
    feedbackAnim.setValue(0);
    setQTimeLeft(timePerQuestion);
    setQIdx(i => i + 1);
    timerAnim.setValue(1);
  }, [timePerQuestion, timerAnim, feedbackAnim]);

  const markAnswer = useCallback((isCorrect) => {
    setFeedback(isCorrect ? 'correct' : 'wrong');
    setTotal(prev => prev + 1);
    if (isCorrect) {
      setScore(prev => prev + 1);
      setStreak(prev => {
        const ns = prev + 1;
        setBestStreak(b => Math.max(b, ns));
        return ns;
      });
    } else {
      setStreak(0);
    }
    // Animate feedback banner in
    Animated.timing(feedbackAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [feedbackAnim]);

  // Game timer
  useEffect(() => {
    if (gameOver) return;
    gameTimerRef.current = setInterval(() => {
      setGameTimeLeft(t => {
        if (t <= 1) { clearInterval(gameTimerRef.current); setGameOver(true); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(gameTimerRef.current);
  }, [gameOver]);

  // Per-question timer
  useEffect(() => {
    if (gameOver || selAns !== null || multiDone) return;
    setQTimeLeft(timePerQuestion);
    timerAnim.setValue(1);
    Animated.timing(timerAnim, {
      toValue: 0, duration: timePerQuestion * 1000, useNativeDriver: false,
    }).start();

    qTimerRef.current = setInterval(() => {
      setQTimeLeft(t => {
        if (t <= 1) {
          clearInterval(qTimerRef.current);
          markAnswer(false);
          setTimeout(nextQuestion, showAnswersAfter ? 1400 : 600);
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => { clearInterval(qTimerRef.current); timerAnim.stopAnimation(); };
  }, [qIdx, gameOver]);

  const handleAnswer = (ansIdx) => {
    if (selAns !== null || gameOver) return;
    clearInterval(qTimerRef.current);
    timerAnim.stopAnimation();
    setSelAns(ansIdx);
    const isCorrect = curQ.correctAnswers?.[ansIdx] === true;
    markAnswer(isCorrect);
    setTimeout(nextQuestion, showAnswersAfter ? (isCorrect ? 900 : 1400) : 500);
  };

  const handleMultiToggle = (ansIdx) => {
    if (multiDone || gameOver) return;
    setMultiSel(prev =>
      prev.includes(ansIdx) ? prev.filter(i => i !== ansIdx) : [...prev, ansIdx]
    );
  };

  const handleMultiConfirm = () => {
    if (multiDone || gameOver || multiSel.length === 0) return;
    clearInterval(qTimerRef.current);
    timerAnim.stopAnimation();
    setMultiDone(true);
    const correctIdxs = (curQ.correctAnswers || []).map((v, i) => v ? i : -1).filter(i => i >= 0);
    const sorted = (a) => [...a].sort((x, y) => x - y);
    const isCorrect = JSON.stringify(sorted(multiSel)) === JSON.stringify(sorted(correctIdxs));
    markAnswer(isCorrect);
    setTimeout(nextQuestion, showAnswersAfter ? (isCorrect ? 900 : 1600) : 500);
  };

  const confirmQuit = () => {
    clearInterval(qTimerRef.current);
    clearInterval(gameTimerRef.current);
    timerAnim.stopAnimation();
    setShowQuitModal(false);
    setGameOver(true);
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const accuracy = total > 0 ? Math.round((score / total) * 100) : 0;
  const gradeInfo = GRADE_THRESHOLDS.find(g => accuracy >= g.min) || GRADE_THRESHOLDS[GRADE_THRESHOLDS.length - 1];

  // ── GAME OVER ─────────────────────────────────────────────────────────────
  if (gameOver) {
    return (
      <SafeAreaView style={S.container}>
        <ScrollView contentContainerStyle={S.gameOverScroll}>
          {/* Set cover + title */}
          <View style={S.coverRow}>
            {coverImage
              ? <Image source={{ uri: coverImage }} style={[S.coverImg, { width: Math.max(64, 80 * rs), height: Math.max(64, 80 * rs) }]} resizeMode="cover" />
              : <View style={[S.coverPlaceholder, { width: Math.max(64, 80 * rs), height: Math.max(64, 80 * rs) }]}>
                  <Text style={{ color: '#555', fontSize: Math.max(18, 22 * rs), fontWeight: 'bold' }}>{title?.substring(0,2).toUpperCase() || '?'}</Text>
                </View>
            }
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={[S.gameOverTitle, { fontSize: Math.max(18, 24 * rs), textAlign: 'left' }]}>{title}</Text>
              <Text style={[S.gradeMsg, { fontSize: Math.max(14, 17 * rs), color: gradeInfo.color, textAlign: 'left', marginBottom: 0 }]}>{gradeInfo.msg}</Text>
            </View>
          </View>

          {/* Stats */}
          <View style={[S.statsRow, { marginBottom: Math.max(16, 22 * rs) }]}>
            {[
              { num: score,            lbl: 'CORRECT',     col: '#00c781' },
              { num: total - score,    lbl: 'WRONG',       col: '#e74c3c' },
              { num: `${accuracy}%`,  lbl: 'ACCURACY',    col: gradeInfo.color },
              { num: bestStreak,       lbl: 'BEST STREAK', col: '#f39c12' },
            ].map(({ num, lbl, col }) => (
              <View key={lbl} style={S.statBox}>
                <Text style={[S.statNum, { fontSize: Math.max(20, 28 * rs), color: col }]}>{num}</Text>
                <Text style={[S.statLbl, { fontSize: Math.max(9, 11 * rs) }]}>{lbl}</Text>
              </View>
            ))}
          </View>

          {/* Progress bar */}
          <View style={[S.progressTrack, { marginBottom: Math.max(20, 28 * rs) }]}>
            <View style={[S.progressFill, { width: `${accuracy}%`, backgroundColor: gradeInfo.color }]} />
          </View>

          {/* Buttons */}
          <TouchableOpacity
            style={[S.playAgainBtn, { paddingVertical: Math.max(12, 16 * rs), marginBottom: 12 }]}
            onPress={() => {
              deckRef.current = buildDeck(questions, randomizeQuestions, randomizeAnswers);
              setQIdx(0); setScore(0); setTotal(0); setStreak(0); setBestStreak(0);
              setSelAns(null); setMultiSel([]); setMultiDone(false); setFeedback(null);
              setQTimeLeft(timePerQuestion);
              setGameTimeLeft(gameDuration * 60);
              setGameOver(false);
              timerAnim.setValue(1); feedbackAnim.setValue(0);
            }}
          >
            <Text style={[S.playAgainTxt, { fontSize: Math.max(15, 18 * rs) }]}>Play Again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.doneBtn, { paddingVertical: Math.max(11, 14 * rs) }]}
            onPress={() => navigation.navigate('Dashboard')}
          >
            <Text style={[S.doneBtnTxt, { fontSize: Math.max(13, 16 * rs) }]}>Go Back to Dashboard</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!curQ) {
    return (
      <SafeAreaView style={S.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 18, marginBottom: 24 }}>No questions in this set.</Text>
          <TouchableOpacity style={S.doneBtn} onPress={() => navigation.goBack()}>
            <Text style={S.doneBtnTxt}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── QUIZ SCREEN ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={S.container}>
      {/* Top bar */}
      <View style={[S.topBar, { paddingHorizontal: Math.max(10, 16 * rs), paddingVertical: Math.max(6, 10 * rs) }]}>
        <View style={S.topCell}>
          <Text style={[S.topLbl, { fontSize: Math.max(8, 10 * rs) }]}>SCORE</Text>
          <Text style={[S.topVal, { fontSize: Math.max(14, 18 * rs), color: '#00c781' }]}>{score}/{total}</Text>
        </View>
        <View style={S.topCell}>
          <Text style={[S.topLbl, { fontSize: Math.max(8, 10 * rs) }]}>TIME</Text>
          <Text style={[S.topVal, { fontSize: Math.max(14, 18 * rs), color: gameTimeLeft <= 30 ? '#e74c3c' : '#fff' }]}>
            {formatTime(gameTimeLeft)}
          </Text>
        </View>
        <View style={S.topCell}>
          <Text style={[S.topLbl, { fontSize: Math.max(8, 10 * rs) }]}>STREAK</Text>
          <Text style={[S.topVal, { fontSize: Math.max(14, 18 * rs), color: streak > 0 ? '#f39c12' : '#555' }]}>
            {streak > 0 ? `x${streak}` : '—'}
          </Text>
        </View>
        <View style={S.topCell}>
          <Text style={[S.topLbl, { fontSize: Math.max(8, 10 * rs) }]}>Q TIMER</Text>
          <Text style={[S.topVal, { fontSize: Math.max(14, 18 * rs), color: qTimeLeft <= 5 ? '#e74c3c' : '#aaa' }]}>{qTimeLeft}s</Text>
        </View>
        <TouchableOpacity onPress={() => setShowQuitModal(true)} style={S.quitBtn}>
          <Text style={[S.quitTxt, { fontSize: Math.max(10, 12 * rs) }]}>Quit</Text>
        </TouchableOpacity>
      </View>

      {/* Question timer bar */}
      <View style={S.timerTrack}>
        <Animated.View style={[S.timerFill, {
          width: timerAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          backgroundColor: timerAnim.interpolate({ inputRange: [0, 0.3, 1], outputRange: ['#e74c3c', '#f39c12', '#00c781'] }),
        }]} />
      </View>

      <ScrollView contentContainerStyle={[S.qScroll, { padding: Math.max(12, 18 * rs), paddingBottom: 30 }]}>
        {/* Q counter */}
        <Text style={[S.qNum, { fontSize: Math.max(10, 12 * rs), marginBottom: Math.max(4, 6 * rs) }]}>
          Question {(qIdx % deck.length) + 1} of {deck.length}
        </Text>

        {/* Question text */}
        <Text style={[S.qTxt, { fontSize: Math.max(15, 19 * rs), lineHeight: Math.max(22, 27 * rs), marginBottom: Math.max(14, 20 * rs) }]}>
          {curQ.question}
        </Text>

        {/* Feedback banner */}
        {feedback && showAnswersAfter && (
          <Animated.View style={[S.feedbackBanner, {
            backgroundColor: feedback === 'correct' ? '#004d20' : '#4d0000',
            opacity: feedbackAnim,
            marginBottom: Math.max(8, 12 * rs),
          }]}>
            <Text style={[S.feedbackTxt, { fontSize: Math.max(13, 16 * rs) }]}>
              {feedback === 'correct' ? 'Correct!' : 'Wrong'}
            </Text>
          </Animated.View>
        )}

        {/* Answers */}
        {curQ.type === 'multiSelect' ? (
          <View style={{ gap: Math.max(7, 10 * rs) }}>
            <Text style={{ color: '#3498db', fontSize: Math.max(10, 12 * rs), marginBottom: 4, textAlign: 'center' }}>
              Select ALL correct answers, then tap Confirm
            </Text>
            {answers.map((ans, i) => {
              const isSel = multiSel.includes(i);
              let bg = isSel ? '#001d33' : '#1e1e1e';
              let border = isSel ? '#3498db' : '#2a2a2a';
              if (multiDone && showAnswersAfter) {
                if (curQ.correctAnswers?.[i]) { bg = '#004d20'; border = '#00c781'; }
                else if (isSel) { bg = '#4d0000'; border = '#e74c3c'; }
              }
              return (
                <TouchableOpacity key={i}
                  style={[S.ansBtn, { backgroundColor: bg, borderColor: border, paddingVertical: Math.max(11, 14 * rs), flexDirection: 'row', alignItems: 'center' }]}
                  onPress={() => handleMultiToggle(i)} disabled={multiDone} activeOpacity={0.75}
                >
                  <View style={[S.checkbox, { borderColor: isSel ? '#3498db' : '#555', backgroundColor: isSel ? '#3498db' : 'transparent' }]}>
                    {isSel && <Text style={S.checkmark}>✓</Text>}
                  </View>
                  <Text style={[S.ansTxt, { fontSize: Math.max(13, 16 * rs), flex: 1, textAlign: 'left' }]}>{ans || `Answer ${i + 1}`}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[S.ansBtn, { backgroundColor: '#1a3a5c', borderColor: '#3498db', paddingVertical: Math.max(11, 14 * rs), opacity: multiSel.length > 0 && !multiDone ? 1 : 0.4 }]}
              onPress={handleMultiConfirm} disabled={multiDone || multiSel.length === 0} activeOpacity={0.75}
            >
              <Text style={[S.ansTxt, { fontSize: Math.max(13, 16 * rs), color: '#3498db', fontWeight: 'bold' }]}>Confirm</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ gap: Math.max(7, 10 * rs) }}>
            {answers.map((ans, i) => {
              let bg = '#1e1e1e', border = '#2a2a2a';
              if (selAns !== null && showAnswersAfter) {
                if (curQ.correctAnswers?.[i]) { bg = '#004d20'; border = '#00c781'; }
                else if (i === selAns) { bg = '#4d0000'; border = '#e74c3c'; }
              } else if (selAns === i) {
                bg = '#1a2a1a'; border = '#555';
              }
              return (
                <TouchableOpacity key={i}
                  style={[S.ansBtn, { backgroundColor: bg, borderColor: border, paddingVertical: Math.max(11, 14 * rs) }]}
                  onPress={() => handleAnswer(i)} disabled={selAns !== null} activeOpacity={0.75}
                >
                  <Text style={[S.ansTxt, { fontSize: Math.max(13, 16 * rs) }]}>{ans || `Answer ${i + 1}`}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Quit confirmation modal */}
      <Modal visible={showQuitModal} transparent animationType="fade">
        <View style={S.modalOverlay}>
          <View style={S.modalBox}>
            <Text style={[S.modalTitle, { fontSize: Math.max(17, 20 * rs) }]}>Quit Quiz?</Text>
            <Text style={[S.modalSub, { fontSize: Math.max(12, 14 * rs) }]}>
              Your current score is {score}/{total}. You'll be taken to the results screen.
            </Text>
            <View style={S.modalBtns}>
              <TouchableOpacity style={S.modalKeepBtn} onPress={() => setShowQuitModal(false)}>
                <Text style={[S.modalKeepTxt, { fontSize: Math.max(13, 15 * rs) }]}>Keep Playing</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.modalQuitBtn} onPress={confirmQuit}>
                <Text style={[S.modalQuitTxt, { fontSize: Math.max(13, 15 * rs) }]}>End Quiz</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0d0d0d' },

  topBar:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderBottomWidth: 1, borderBottomColor: '#222' },
  topCell:      { flex: 1, alignItems: 'center' },
  topLbl:       { color: '#555', fontWeight: '700', letterSpacing: 0.8 },
  topVal:       { color: '#fff', fontWeight: 'bold', marginTop: 1 },
  quitBtn:      { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#2a0000', borderRadius: 8, marginLeft: 6 },
  quitTxt:      { color: '#ff6b6b', fontWeight: 'bold' },

  timerTrack:   { width: '100%', height: 5, backgroundColor: '#1a1a1a' },
  timerFill:    { height: '100%' },

  qScroll:      { flexGrow: 1 },
  qNum:         { color: '#555', fontWeight: '700', letterSpacing: 1 },
  qTxt:         { color: '#fff', fontWeight: '700', textAlign: 'center' },

  feedbackBanner: { borderRadius: 10, padding: 10, alignItems: 'center' },
  feedbackTxt:    { color: '#fff', fontWeight: 'bold' },

  ansBtn:       { borderRadius: 12, borderWidth: 2, alignItems: 'center', paddingHorizontal: 16 },
  ansTxt:       { color: '#fff', fontWeight: '600' },
  checkbox:     { width: 20, height: 20, borderRadius: 4, borderWidth: 2, marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  checkmark:    { color: '#fff', fontSize: 13, fontWeight: 'bold' },

  // Quit modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  modalBox:     { backgroundColor: '#1e1e1e', borderRadius: 20, padding: 28, width: '85%', maxWidth: 380, alignItems: 'center', borderWidth: 1.5, borderColor: '#333' },
  modalTitle:   { color: '#fff', fontWeight: '900', marginBottom: 10 },
  modalSub:     { color: '#aaa', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  modalBtns:    { flexDirection: 'row', gap: 12, width: '100%' },
  modalKeepBtn: { flex: 1, backgroundColor: '#00c781', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  modalKeepTxt: { color: '#fff', fontWeight: 'bold' },
  modalQuitBtn: { flex: 1, backgroundColor: '#2a0000', paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#c0392b' },
  modalQuitTxt: { color: '#ff6b6b', fontWeight: 'bold' },

  // Game over screen
  gameOverScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  gameOverTitle:  { color: '#fff', fontWeight: '900', marginBottom: 4 },
  gradeMsg:       { fontWeight: 'bold', marginBottom: 20 },
  coverRow:       { flexDirection: 'row', alignItems: 'center', width: '100%', maxWidth: 460, marginBottom: 24, backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2a2a2a' },
  coverImg:       { borderRadius: 10 },
  coverPlaceholder: { borderRadius: 10, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },

  statsRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 20, width: '100%' },
  statBox:      { alignItems: 'center', backgroundColor: '#1e1e1e', borderRadius: 14, padding: 16, minWidth: 80, flex: 1, borderWidth: 1, borderColor: '#2a2a2a' },
  statNum:      { fontWeight: '900' },
  statLbl:      { color: '#555', fontWeight: '700', letterSpacing: 0.8, marginTop: 4, textAlign: 'center' },

  progressTrack:  { width: '100%', height: 8, backgroundColor: '#1a1a1a', borderRadius: 4, overflow: 'hidden' },
  progressFill:   { height: '100%', borderRadius: 4 },



  playAgainBtn: { backgroundColor: '#00c781', borderRadius: 14, paddingHorizontal: 32, width: '100%', maxWidth: 380, alignItems: 'center' },
  playAgainTxt: { color: '#fff', fontWeight: 'bold' },
  doneBtn:      { backgroundColor: '#1e1e1e', borderRadius: 14, paddingHorizontal: 32, width: '100%', maxWidth: 380, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  doneBtnTxt:   { color: '#aaa', fontWeight: 'bold' },
});