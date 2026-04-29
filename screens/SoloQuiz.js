/**
 * SoloQuiz.js
 * Solo play — just answer questions from the set. No board, no multiplayer.
 * Settings: time per question, total game duration.
 * Shows: question, answers, running score, time remaining, progress.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  ScrollView, Animated, useWindowDimensions, Modal,
} from "react-native";

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function SoloQuiz({ navigation, route }) {
  const { questions = [], title = "", timePerQuestion = 20, gameDuration = 10 } = route.params || {};
  const { width: winW, height: winH } = useWindowDimensions();
  const rs = Math.min(1, Math.max(0.6, winW / 480, winH / 700));

  // Build shuffled question deck, cycling if needed
  const deckRef = useRef(shuffleArray(questions));
  const [qIdx,        setQIdx]        = useState(0);
  const [selAns,      setSelAns]      = useState(null);
  const [feedback,    setFeedback]    = useState(null); // "correct" | "wrong"
  const [score,       setScore]       = useState(0);
  const [total,       setTotal]       = useState(0);
  const [gameOver,    setGameOver]    = useState(false);
  const [qTimeLeft,   setQTimeLeft]   = useState(timePerQuestion);
  const [gameTimeLeft,setGameTimeLeft]= useState(gameDuration * 60);

  // Timer bar animation
  const timerAnim = useRef(new Animated.Value(1)).current;
  const qTimerRef  = useRef(null);
  const gameTimerRef = useRef(null);

  const curQ = deckRef.current[qIdx % deckRef.current.length];

  const nextQuestion = useCallback(() => {
    setSelAns(null);
    setFeedback(null);
    setQTimeLeft(timePerQuestion);
    setQIdx(i => i + 1);
    timerAnim.setValue(1);
  }, [timePerQuestion, timerAnim]);

  // Game-level countdown
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
    if (gameOver || selAns !== null) return;
    setQTimeLeft(timePerQuestion);
    timerAnim.setValue(1);

    // Animate bar
    Animated.timing(timerAnim, {
      toValue: 0,
      duration: timePerQuestion * 1000,
      useNativeDriver: false,
    }).start();

    qTimerRef.current = setInterval(() => {
      setQTimeLeft(t => {
        if (t <= 1) {
          clearInterval(qTimerRef.current);
          // Time's up — mark as wrong and move on after delay
          setFeedback("wrong");
          setTotal(prev => prev + 1);
          setTimeout(nextQuestion, 1200);
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => {
      clearInterval(qTimerRef.current);
      timerAnim.stopAnimation();
    };
  }, [qIdx, gameOver]);

  const handleAnswer = (ansIdx) => {
    if (selAns !== null || gameOver) return;
    clearInterval(qTimerRef.current);
    timerAnim.stopAnimation();

    const isCorrect = curQ.correctAnswers?.[ansIdx] === true;
    setSelAns(ansIdx);
    setFeedback(isCorrect ? "correct" : "wrong");
    setTotal(prev => prev + 1);
    if (isCorrect) setScore(prev => prev + 1);

    setTimeout(nextQuestion, isCorrect ? 900 : 1400);
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const accuracy = total > 0 ? Math.round((score / total) * 100) : 0;

  // ── Game Over Screen ────────────────────────────────────────────────────────
  if (gameOver) {
    return (
      <SafeAreaView style={S.container}>
        <View style={S.gameOverBox}>
          <Text style={[S.gameOverTitle, { fontSize: Math.max(22, 30 * rs) }]}>Time's Up!</Text>
          <Text style={[S.gameOverSub, { fontSize: Math.max(14, 17 * rs) }]}>{title}</Text>

          <View style={S.statsRow}>
            <View style={S.statBox}>
              <Text style={[S.statNum, { fontSize: Math.max(28, 40 * rs), color: "#00c781" }]}>{score}</Text>
              <Text style={[S.statLbl, { fontSize: Math.max(11, 13 * rs) }]}>CORRECT</Text>
            </View>
            <View style={S.statBox}>
              <Text style={[S.statNum, { fontSize: Math.max(28, 40 * rs) }]}>{total}</Text>
              <Text style={[S.statLbl, { fontSize: Math.max(11, 13 * rs) }]}>ANSWERED</Text>
            </View>
            <View style={S.statBox}>
              <Text style={[S.statNum, { fontSize: Math.max(28, 40 * rs), color: accuracy >= 70 ? "#00c781" : accuracy >= 40 ? "#f39c12" : "#e74c3c" }]}>{accuracy}%</Text>
              <Text style={[S.statLbl, { fontSize: Math.max(11, 13 * rs) }]}>ACCURACY</Text>
            </View>
          </View>

          <Text style={[S.resultMsg, { fontSize: Math.max(14, 17 * rs) }]}>
            {accuracy >= 80 ? "Excellent work!" : accuracy >= 60 ? "Good effort!" : accuracy >= 40 ? "Keep practising!" : "Keep trying — you'll get there!"}
          </Text>

          <TouchableOpacity
            style={[S.doneBtn, { paddingVertical: Math.max(12, 16 * rs) }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={[S.doneBtnTxt, { fontSize: Math.max(14, 17 * rs) }]}>Back to Game Settings</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!curQ) {
    return (
      <SafeAreaView style={S.container}>
        <Text style={{ color: "#fff", textAlign: "center", marginTop: 40 }}>No questions in this set.</Text>
        <TouchableOpacity style={[S.doneBtn, { margin: 24 }]} onPress={() => navigation.goBack()}>
          <Text style={S.doneBtnTxt}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const answers = curQ.type === "trueFalse" ? ["True", "False"] : (curQ.answers || []);

  return (
    <SafeAreaView style={S.container}>
      {/* ── Top bar ── */}
      <View style={[S.topBar, { paddingHorizontal: Math.max(12, 18 * rs), paddingVertical: Math.max(8, 12 * rs) }]}>
        <View style={S.topCell}>
          <Text style={[S.topLbl, { fontSize: Math.max(9, 11 * rs) }]}>SCORE</Text>
          <Text style={[S.topVal, { fontSize: Math.max(16, 22 * rs), color: "#00c781" }]}>{score}/{total}</Text>
        </View>
        <View style={S.topCell}>
          <Text style={[S.topLbl, { fontSize: Math.max(9, 11 * rs) }]}>TIME LEFT</Text>
          <Text style={[S.topVal, { fontSize: Math.max(16, 22 * rs), color: gameTimeLeft <= 30 ? "#e74c3c" : "#fff" }]}>
            {formatTime(gameTimeLeft)}
          </Text>
        </View>
        <View style={S.topCell}>
          <Text style={[S.topLbl, { fontSize: Math.max(9, 11 * rs) }]}>Q TIMER</Text>
          <Text style={[S.topVal, { fontSize: Math.max(16, 22 * rs), color: qTimeLeft <= 5 ? "#e74c3c" : "#aaa" }]}>{qTimeLeft}s</Text>
        </View>
        <TouchableOpacity onPress={() => setGameOver(true)} style={S.quitBtn}>
          <Text style={[S.quitTxt, { fontSize: Math.max(11, 13 * rs) }]}>Quit</Text>
        </TouchableOpacity>
      </View>

      {/* ── Question timer bar ── */}
      <View style={S.timerTrack}>
        <Animated.View style={[S.timerFill, {
          width: timerAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
          backgroundColor: timerAnim.interpolate({ inputRange: [0, 0.3, 1], outputRange: ["#e74c3c", "#f39c12", "#00c781"] }),
        }]} />
      </View>

      {/* ── Question + Answers ── */}
      <ScrollView contentContainerStyle={[S.qScroll, { padding: Math.max(14, 20 * rs), paddingBottom: 30 }]}>
        {/* Feedback flash */}
        {feedback && (
          <View style={[S.feedbackBanner, { backgroundColor: feedback === "correct" ? "#004d20" : "#4d0000", marginBottom: Math.max(8, 12 * rs) }]}>
            <Text style={[S.feedbackTxt, { fontSize: Math.max(13, 16 * rs) }]}>
              {feedback === "correct" ? "Correct!" : "Wrong"}
            </Text>
          </View>
        )}

        <Text style={[S.qNum, { fontSize: Math.max(11, 13 * rs), marginBottom: Math.max(6, 8 * rs) }]}>
          Question {(qIdx % deckRef.current.length) + 1} of {deckRef.current.length}
        </Text>

        <Text style={[S.qTxt, { fontSize: Math.max(16, 20 * rs), lineHeight: Math.max(22, 28 * rs), marginBottom: Math.max(16, 22 * rs) }]}>
          {curQ.question}
        </Text>

        <View style={{ gap: Math.max(8, 11 * rs) }}>
          {answers.map((ans, i) => {
            let bg = "#1e1e1e", border = "#2a2a2a";
            if (selAns !== null) {
              if (curQ.correctAnswers?.[i]) { bg = "#004d20"; border = "#00c781"; }
              else if (i === selAns && !curQ.correctAnswers?.[i]) { bg = "#4d0000"; border = "#e74c3c"; }
            }
            return (
              <TouchableOpacity
                key={i}
                style={[S.ansBtn, { backgroundColor: bg, borderColor: border, paddingVertical: Math.max(12, 16 * rs) }]}
                onPress={() => handleAnswer(i)}
                disabled={selAns !== null}
                activeOpacity={0.75}
              >
                <Text style={[S.ansTxt, { fontSize: Math.max(14, 17 * rs) }]}>{ans || `Answer ${i + 1}`}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container:  { flex: 1, backgroundColor: "#0d0d0d" },

  topBar:     { flexDirection: "row", alignItems: "center", backgroundColor: "#111", borderBottomWidth: 1, borderBottomColor: "#222" },
  topCell:    { flex: 1, alignItems: "center" },
  topLbl:     { color: "#555", fontWeight: "700", letterSpacing: 0.8 },
  topVal:     { color: "#fff", fontWeight: "bold", marginTop: 2 },
  quitBtn:    { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#2a0000", borderRadius: 10 },
  quitTxt:    { color: "#ff6b6b", fontWeight: "bold" },

  timerTrack: { width: "100%", height: 6, backgroundColor: "#1a1a1a" },
  timerFill:  { height: "100%" },

  qScroll:    { flexGrow: 1 },
  feedbackBanner: { borderRadius: 10, padding: 10, alignItems: "center" },
  feedbackTxt:    { color: "#fff", fontWeight: "bold" },
  qNum:       { color: "#555", fontWeight: "700", letterSpacing: 1 },
  qTxt:       { color: "#fff", fontWeight: "700", textAlign: "center" },
  ansBtn:     { borderRadius: 12, borderWidth: 2, alignItems: "center", paddingHorizontal: 16 },
  ansTxt:     { color: "#fff", fontWeight: "600" },

  gameOverBox:  { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  gameOverTitle:{ color: "#fff", fontWeight: "900", marginBottom: 6 },
  gameOverSub:  { color: "#888", marginBottom: 32 },
  statsRow:     { flexDirection: "row", gap: 16, marginBottom: 24 },
  statBox:      { alignItems: "center", backgroundColor: "#1e1e1e", borderRadius: 16, padding: 20, minWidth: 90, borderWidth: 1, borderColor: "#2a2a2a" },
  statNum:      { fontWeight: "900" },
  statLbl:      { color: "#555", fontWeight: "700", letterSpacing: 1, marginTop: 4 },
  resultMsg:    { color: "#aaa", marginBottom: 32 },
  doneBtn:      { backgroundColor: "#00c781", borderRadius: 14, paddingHorizontal: 32, width: "100%", maxWidth: 380, alignItems: "center" },
  doneBtnTxt:   { color: "#fff", fontWeight: "bold" },
});