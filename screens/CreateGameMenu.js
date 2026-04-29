/**
 * CreateGameMenu.js
 * Fix: saveGame now validates that every question has at least one correct answer marked.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Image, ActivityIndicator, Pressable, Platform, useWindowDimensions,
} from "react-native";
import { db, auth } from '../firebaseConfig';
import {
  doc,
  getDoc,
  addDoc,
  updateDoc,
  collection,
} from 'firebase/firestore';


// Module-level constant — never stale in any closure regardless of re-renders
const BLANK_QUESTION = {
  type: 'multipleChoice',
  question: '',
  answers: ['', '', '', ''],
  correctAnswers: [false, false, false, false],
  imageUrl: null,
  timeLimit: 20,
};
const blankQuestion = () => ({ ...BLANK_QUESTION });

export default function CreateGameMenu({ navigation, route }) {
  const { width: winW } = useWindowDimensions();
  const isMobile = winW < 700;
  const gameId = route.params?.gameId;
  const initialTitle = route.params?.initialTitle || '';

  const [gameTitle, setGameTitle] = useState(initialTitle);
  const [coverImage, setCoverImage] = useState(null);
  const [tags, setTags] = useState('');
  const [questions, setQuestions] = useState([]);
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const coverInputRef = useRef(null);
  const questionInputRef = useRef(null);
  const initializedRef = useRef(false);

  // Fires exactly once on mount
  useEffect(() => {
    if (initializedRef.current) return;
    if (gameId) {
      // Loading a saved game
      const loadGame = async () => {
        setIsLoading(true);
        try {
          const docSnap = await getDoc(doc(db, 'games', gameId));
          if (docSnap.exists()) {
            const data = docSnap.data();
            setGameTitle(data.title || '');
            setTags(data.tags?.join(', ') || '');
            const qs = data.questions?.length ? data.questions : [blankQuestion()];
            setQuestions(qs);
            setCoverImage(data.coverImage || null);
            setIsEditing(true);
            setSelectedQuestionIndex(0);
          }
        } catch (err) { console.error('Load failed:', err); alert('Failed to load game.'); }
        setIsLoading(false);
      };
      loadGame();
    } else {
      // New game — start with one blank question
      setQuestions([blankQuestion()]);
      setSelectedQuestionIndex(0);
    }
    initializedRef.current = true;
  }, []); // eslint-disable-line

  const safeIdx = Math.min(selectedQuestionIndex, Math.max(0, questions.length - 1));
  const currentQuestion = questions[safeIdx] || blankQuestion();

  const updateCurrentQuestion = (updates) => {
    setQuestions(prev => {
      const updated = [...prev];
      const idx = Math.min(selectedQuestionIndex, updated.length - 1);
      updated[idx] = { ...updated[idx], ...updates };
      return updated;
    });
  };

  const addQuestion = () => {
    setQuestions(prev => {
      const next = [...prev, blankQuestion()];
      setSelectedQuestionIndex(next.length - 1);
      return next;
    });
  };

  const deleteQuestion = (index) => {
    setQuestions(prev => {
      if (prev.length <= 1) return prev; // always keep at least 1
      const next = prev.filter((_, i) => i !== index);
      setSelectedQuestionIndex(Math.min(index, next.length - 1));
      return next;
    });
  };

  const moveQuestionUp = (index) => {
    if (index === 0) return;
    setQuestions(prev => {
      const newQuestions = [...prev];
      [newQuestions[index - 1], newQuestions[index]] = [newQuestions[index], newQuestions[index - 1]];
      return newQuestions;
    });
    setSelectedQuestionIndex(index - 1);
  };

  const moveQuestionDown = (index) => {
    if (index === questions.length - 1) return;
    setQuestions(prev => {
      const newQuestions = [...prev];
      [newQuestions[index], newQuestions[index + 1]] = [newQuestions[index + 1], newQuestions[index]];
      return newQuestions;
    });
    setSelectedQuestionIndex(index + 1);
  };

  const [imageUploading, setImageUploading] = useState(false);

  // Read image file as base64 data URL — stored directly in Firestore, no Firebase Storage needed.
  // Uses plain FileReader so it works in Expo web without conflicting with RN's Image component.
  const readAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(file);
  });

  // Resize + compress image to stay well under Firestore 1MB doc limit
  const compressImage = (dataUrl, maxPx = 400) => new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => resolve(dataUrl); // fallback: use original
    img.src = dataUrl;
  });

  const handleImageUpload = async (e, isCover = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg','image/png','image/gif','image/webp'];
    if (!allowed.includes(file.type)) {
      alert('Please choose a JPEG, PNG, GIF or WebP image.');
      e.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert('Please choose an image under 2 MB. Tip: use a compressed JPG or PNG.');
      e.target.value = '';
      return;
    }
    setImageUploading(true);
    try {
      const raw = await readAsBase64(file);
      const base64 = await compressImage(raw, isCover ? 400 : 600);
      if (isCover) { setCoverImage(base64); } else { updateCurrentQuestion({ imageUrl: base64 }); }
      e.target.value = '';
    } catch (err) {
      console.error('Image read failed:', err);
      alert('Could not load image: ' + (err?.message || String(err)));
    } finally {
      setImageUploading(false);
    }
  };

  const saveGame = async (host = false) => {
    if (!gameTitle.trim()) {
      alert('Please enter a game title');
      return;
    }
    if (questions.length === 0) {
      alert('Please add at least one question');
      return;
    }

    // Validate every question
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question?.trim()) {
        alert(`Question ${i + 1} has no question text. Please add a question before saving.`);
        setSelectedQuestionIndex(i); return;
      }
      const correctCount = (q.correctAnswers || []).filter(v => v === true).length;
      if (q.type === 'multiSelect') {
        if (correctCount < 2) {
          alert(`Question ${i + 1} is a Multi-Select question and needs at least 2 correct answers marked.\n\nCurrently has: ${correctCount}`);
          setSelectedQuestionIndex(i); return;
        }
      } else {
        if (correctCount === 0) {
          alert(`Question ${i + 1} has no correct answer selected.\n\nPlease mark at least one answer as correct before saving.`);
          setSelectedQuestionIndex(i); return;
        }
      }
    }

    const gameData = {
      title: gameTitle.trim(),
      titleLower: gameTitle.trim().toLowerCase(),
      tags: tags.split(',').map(t => t.trim().toLowerCase()).filter(t => t),
      questions,
      numQuestions: questions.length,
      coverImage,
      creatorId: auth.currentUser.uid,
      updatedAt: new Date().toISOString(),
      isPublished: false,
    };

    try {
      let savedId = gameId;
      if (isEditing && gameId) {
        await updateDoc(doc(db, 'games', gameId), gameData);
      } else {
        const docRef = await addDoc(collection(db, 'games'), gameData);
        savedId = docRef.id;
      }
      if (host) {
        navigation.navigate('HostGameMenu', { gameId: savedId });
      } else {
        navigation.goBack();
      }
    } catch (err) {
      console.error('Save failed', err);
      alert('Failed to save game');
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#00c781" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" ref={coverInputRef} style={{ display: 'none' }} onChange={(e) => handleImageUpload(e, true)} />
      <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" ref={questionInputRef} style={{ display: 'none' }} onChange={(e) => handleImageUpload(e, false)} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEditing ? 'Edit Game' : 'Create Game'}</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.coverSection}>
        <TouchableOpacity style={styles.coverUpload} onPress={() => coverInputRef.current?.click()}>
          {coverImage ? (
            <Image source={{ uri: coverImage }} style={styles.coverImage} />
          ) : (
            <Text style={styles.coverPlaceholder}>+ Add Cover Image</Text>
          )}
          <View style={styles.coverOverlay}><Text style={styles.coverOverlayText}>Upload</Text></View>
        </TouchableOpacity>
        <View style={styles.titleSection}>
          <TextInput style={styles.gameTitleInput} value={gameTitle} onChangeText={setGameTitle} placeholder="Enter game title..." placeholderTextColor="#666" />
          <TextInput style={styles.tagsInput} value={tags} onChangeText={setTags} placeholder="Tags (comma separated)" placeholderTextColor="#666" />
        </View>
      </View>

      <View style={[styles.mainLayout, isMobile && {flexDirection:"column"}]}>
        {/* Left: Question Navigator */}
        <View style={styles.leftSidebar}>
          <TouchableOpacity style={styles.addQuestionBtn} onPress={addQuestion}>
            <Text style={styles.addQuestionText}>+ Add Question</Text>
          </TouchableOpacity>
          <ScrollView style={styles.questionList} showsVerticalScrollIndicator={true}>
            {questions.map((q, i) => {
              const correctCount = q.correctAnswers?.filter(v=>v===true).length || 0;
              const hasCorrect = q.type==='multiSelect' ? correctCount >= 2 : correctCount >= 1;
              const warnMsg = q.type==='multiSelect' && correctCount < 2
                ? (correctCount === 0 ? 'No correct answers!' : 'Needs 2+ correct!')
                : !hasCorrect ? 'No correct answer!' : null;
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.questionThumb,
                    selectedQuestionIndex === i && styles.questionThumbSelected,
                    !hasCorrect && styles.questionThumbNoAnswer,
                  ]}
                  onPress={() => setSelectedQuestionIndex(i)}
                >
                  <Text style={styles.thumbNumber}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.thumbText} numberOfLines={2}>{q.question || 'New Question'}</Text>
                    {warnMsg && <Text style={styles.noAnswerWarning}>{warnMsg}</Text>}
                  </View>
                  <View style={styles.reorderButtons}>
                    <TouchableOpacity onPress={() => moveQuestionUp(i)} disabled={i === 0}>
                      <Text style={[styles.reorderText, i === 0 && styles.disabledReorder]}>↑</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => moveQuestionDown(i)} disabled={i === questions.length - 1}>
                      <Text style={[styles.reorderText, i === questions.length - 1 && styles.disabledReorder]}>↓</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={styles.deleteThumbBtn} onPress={() => deleteQuestion(i)}>
                    <Text style={styles.deleteThumbText}>×</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Center: Question Editor */}
        <ScrollView style={{flex:1}} contentContainerStyle={styles.centerEditor} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={true}>
          <Text style={styles.editorLabel}>Question {selectedQuestionIndex + 1}</Text>

          {/* Question type picker */}
          <View style={styles.typeRow}>
            {[
              {val:'multipleChoice', label:'Single Choice'},
              {val:'multiSelect',    label:'Multi-Select'},
              {val:'trueFalse',      label:'True / False'},
            ].map(t=>{
              const isCurrent = currentQuestion.type===t.val;
              const comingFromTF = currentQuestion.type==='trueFalse';
              return (
                <TouchableOpacity key={t.val}
                  style={[styles.typeBtn, isCurrent && styles.typeBtnActive]}
                  onPress={()=>{
                    if (isCurrent) return;
                    if (t.val==='trueFalse') {
                      updateCurrentQuestion({ type:'trueFalse', answers:['True','False'], correctAnswers:[false,false] });
                    } else if (comingFromTF) {
                      // Coming FROM trueFalse — always reset to 4 blank answers
                      updateCurrentQuestion({ type:t.val, answers:['','','',''], correctAnswers:[false,false,false,false] });
                    } else {
                      // Choice ↔ MultiSelect — keep existing answers, just clear correct for single
                      const newCorrect = t.val==='multipleChoice'
                        ? currentQuestion.correctAnswers.map(()=>false)
                        : [...currentQuestion.correctAnswers];
                      updateCurrentQuestion({ type:t.val, correctAnswers:newCorrect });
                    }
                  }}>
                  <Text style={[styles.typeBtnTxt, isCurrent && styles.typeBtnTxtActive]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TextInput
            style={styles.questionInput}
            value={currentQuestion.question}
            onChangeText={(t) => updateCurrentQuestion({ question: t })}
            placeholder="Enter your question..."
            multiline
          />

          <TouchableOpacity style={styles.imageUpload} onPress={() => !imageUploading && questionInputRef.current?.click()}>
            {imageUploading ? (
              <ActivityIndicator color="#00c781" size="large"/>
            ) : currentQuestion.imageUrl ? (
              <Image source={{ uri: currentQuestion.imageUrl }} style={styles.questionImage} />
            ) : (
              <Text style={styles.imageUploadText}>+ Add Image (optional)</Text>
            )}
            {!imageUploading && (
              <View style={styles.imageOverlay}>
                <Text style={styles.imageOverlayText}>{currentQuestion.imageUrl ? 'Change Image' : 'Upload'}</Text>
              </View>
            )}
          </TouchableOpacity>
          {currentQuestion.imageUrl ? (
            <TouchableOpacity style={{marginBottom:12}} onPress={()=>updateCurrentQuestion({imageUrl:null})}>
              <Text style={{color:'#e74c3c',fontSize:13}}>✕ Remove image</Text>
            </TouchableOpacity>
          ) : null}

          {currentQuestion.type === 'trueFalse' ? (
            <View style={styles.trueFalseRow}>
              {['True', 'False'].map((label, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.tfBtn, currentQuestion.correctAnswers[i] && styles.tfBtnCorrect]}
                  onPress={() => updateCurrentQuestion({ correctAnswers: i === 0 ? [true, false] : [false, true] })}
                >
                  <Text style={styles.tfText}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            /* Single Choice OR Multi-Select — same UI, but multi-select allows multiple ✓ */
            <>
              {currentQuestion.type==='multiSelect' && (
                <Text style={{color:'#3498db',fontSize:13,marginBottom:8}}>☑ Mark ALL correct answers below</Text>
              )}
              {currentQuestion.answers.map((ans, i) => (
                <View key={i} style={styles.answerRow}>
                  <TextInput
                    style={styles.answerInput}
                    value={ans}
                    onChangeText={(t) => {
                      const newAnswers = [...currentQuestion.answers];
                      newAnswers[i] = t;
                      updateCurrentQuestion({ answers: newAnswers });
                    }}
                    placeholder={`Answer ${i + 1}`}
                  />
                  <TouchableOpacity
                    style={[styles.correctToggle, currentQuestion.correctAnswers[i] && styles.correctToggleActive]}
                    onPress={() => {
                      const newCorrect = [...currentQuestion.correctAnswers];
                      if (currentQuestion.type==='multipleChoice') {
                        newCorrect.fill(false);
                        newCorrect[i] = true;
                      } else {
                        newCorrect[i] = !newCorrect[i];
                      }
                      updateCurrentQuestion({ correctAnswers: newCorrect });
                    }}
                  >
                    <Text style={styles.toggleIcon}>✓</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {/* Add / Remove answer buttons — min 2, max 5 */}
              <View style={styles.answerCountRow}>
                <TouchableOpacity
                  style={[styles.answerCountBtn, currentQuestion.answers.length <= 2 && styles.answerCountBtnDisabled]}
                  disabled={currentQuestion.answers.length <= 2}
                  onPress={() => {
                    const newAnswers = currentQuestion.answers.slice(0, -1);
                    const newCorrect = currentQuestion.correctAnswers.slice(0, -1);
                    updateCurrentQuestion({ answers: newAnswers, correctAnswers: newCorrect });
                  }}>
                  <Text style={styles.answerCountBtnTxt}>− Remove Answer</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.answerCountBtn, currentQuestion.answers.length >= 5 && styles.answerCountBtnDisabled]}
                  disabled={currentQuestion.answers.length >= 5}
                  onPress={() => {
                    const newAnswers = [...currentQuestion.answers, ''];
                    const newCorrect = [...currentQuestion.correctAnswers, false];
                    updateCurrentQuestion({ answers: newAnswers, correctAnswers: newCorrect });
                  }}>
                  <Text style={styles.answerCountBtnTxt}>+ Add Answer</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          <View style={styles.timeSetting}>
            <Text style={styles.settingLabel}>Time Limit</Text>
            <TextInput
              style={styles.timeInput}
              value={currentQuestion.timeLimit.toString()}
              onChangeText={(t) => updateCurrentQuestion({ timeLimit: parseInt(t) || 20 })}
              keyboardType="numeric"
            />
            <Text style={styles.seconds}>seconds</Text>
          </View>
        </ScrollView>

        {/* Right: Summary & Actions */}
        <ScrollView style={[styles.rightSidebar, isMobile && {width:"100%", borderLeftWidth:0, borderTopWidth:1, borderTopColor:"#222", maxHeight: 300}]} contentContainerStyle={{padding:16}} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={true}>
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>Game Summary</Text>
            <Text style={styles.summaryText}>{questions.length} Question(s)</Text>
            <Text style={styles.summaryText}>Tags: {tags || 'None'}</Text>
            {questions.some(q => {
              const c = q.correctAnswers?.filter(v=>v===true).length || 0;
              return q.type==='multiSelect' ? c < 2 : c < 1;
            }) && (
              <Text style={styles.warningText}>⚠ Some questions need correct answers fixed before saving.</Text>
            )}
          </View>
          <View style={styles.actionButtons}>
            <Pressable style={({hovered,pressed})=>[styles.saveExitBtn, Platform.OS==='web'&&hovered&&{backgroundColor:'#555',transform:[{scale:1.03}]}, pressed&&{opacity:0.8}]} onPress={() => saveGame(false)}>
              <Text style={styles.actionBtnText}>Save & Exit</Text>
            </Pressable>
            <Pressable style={({hovered,pressed})=>[styles.saveHostBtn, Platform.OS==='web'&&hovered&&{backgroundColor:'#00e090',transform:[{scale:1.03}]}, pressed&&{opacity:0.8}]} onPress={() => saveGame(true)}>
              <Text style={styles.actionBtnText}>Save & Host</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: '#0d0d0d', borderBottomWidth: 1, borderBottomColor: '#222' },
  backBtn: { color: '#00c781', fontSize: 15, fontWeight: 'bold' },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  coverSection: { flexDirection: 'row', flexWrap: 'wrap', padding: 16, gap: 14, backgroundColor: '#0d0d0d' },
  coverUpload: { width: 160, height: 160, backgroundColor: '#1e1e1e', borderRadius: 16, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  coverImage: { width: '100%', height: '100%', borderRadius: 16 },
  coverPlaceholder: { color: '#666', fontSize: 16 },
  coverOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', borderRadius: 16 },
  coverOverlayText: { color: '#fff', fontWeight: 'bold' },
  titleSection: { flex: 1, justifyContent: 'center' },
  gameTitleInput: { fontSize: 22, fontWeight: 'bold', color: '#fff', backgroundColor: 'transparent', borderBottomWidth: 2, borderBottomColor: '#00c781', paddingBottom: 8, marginBottom: 12 },
  tagsInput: { fontSize: 14, color: '#aaa', backgroundColor: '#222', padding: 12, borderRadius: 8 },
  mainLayout: { flex: 1, flexDirection: 'row' }, // overridden inline
  leftSidebar: { width: 300, backgroundColor: '#0d0d0d', padding: 20, borderRightWidth: 1, borderRightColor: '#222' },
  addQuestionBtn: { backgroundColor: '#00c781', padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 20 },
  addQuestionText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  questionList: { flex: 1, minHeight: 0 },
  questionThumb: { backgroundColor: '#1e1e1e', borderRadius: 12, padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: 'transparent', position: 'relative' },
  questionThumbSelected: { borderColor: '#00c781', backgroundColor: '#003322' },
  questionThumbNoAnswer: { borderColor: '#e74c3c' },
  thumbNumber: { color: '#00c781', fontWeight: 'bold', marginRight: 12, fontSize: 16 },
  thumbText: { color: '#fff' },
  noAnswerWarning: { color: '#e74c3c', fontSize: 11, marginTop: 2 },
  deleteThumbBtn: { position: 'absolute', right: 8, top: 8, width: 24, height: 24, backgroundColor: '#c0392b', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  deleteThumbText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  reorderButtons: { flexDirection: 'column', marginLeft: 8 },
  reorderText: { color: '#00c781', fontSize: 18, fontWeight: 'bold' },
  disabledReorder: { opacity: 0.3 },
  centerEditor: { flexGrow: 1, padding: 24, backgroundColor: '#111' },
  editorLabel: { fontSize: 18, color: '#aaa', marginBottom: 12 },
  typeRow:       { flexDirection: 'row', gap: 8, marginBottom: 16 },
  typeBtn:       { flex: 1, backgroundColor: '#1e1e1e', padding: 10, borderRadius: 10, alignItems: 'center', borderWidth: 2, borderColor: '#333' },
  typeBtnActive: { backgroundColor: '#003322', borderColor: '#00c781' },
  typeBtnTxt:    { color: '#888', fontSize: 13, fontWeight: '600' },
  typeBtnTxtActive: { color: '#00c781' },
  questionInput: { fontSize: 28, color: '#fff', backgroundColor: '#1e1e1e', padding: 20, borderRadius: 16, minHeight: 120, marginBottom: 20 },
  imageUpload: { height: 200, backgroundColor: '#1e1e1e', borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 12, position: 'relative' },
  imageUploadText: { color: '#666', fontSize: 16 },
  questionImage: { width: '100%', height: '100%', borderRadius: 16 },
  imageOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', borderRadius: 16 },
  imageOverlayText: { color: '#fff', fontWeight: 'bold' },
  answerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  answerInput: { flex: 1, backgroundColor: '#1e1e1e', color: '#fff', padding: 16, borderRadius: 12, fontSize: 18 },
  correctToggle: { width: 50, height: 50, backgroundColor: '#333', borderRadius: 25, marginLeft: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'transparent' },
  correctToggleActive: { backgroundColor: '#00c781', borderColor: '#fff' },
  toggleIcon: { color: '#fff', fontSize: 28, fontWeight: 'bold' },
  answerCountRow:          { flexDirection:'row', gap:10, marginTop:8, marginBottom:4 },
  answerCountBtn:          { flex:1, backgroundColor:'#1e1e1e', borderWidth:1.5, borderColor:'#444', borderRadius:10, paddingVertical:10, alignItems:'center' },
  answerCountBtnDisabled:  { opacity:0.35 },
  answerCountBtnTxt:       { color:'#aaa', fontSize:13, fontWeight:'600' },
  tfBtn: { flex: 1, backgroundColor: '#1e1e1e', padding: 20, borderRadius: 16, alignItems: 'center' },
  tfBtnCorrect: { backgroundColor: '#00c781' },
  tfText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  timeSetting: { flexDirection: 'row', alignItems: 'center', marginTop: 30 },
  settingLabel: { color: '#aaa', marginRight: 12 },
  timeInput: { backgroundColor: '#1e1e1e', color: '#fff', width: 60, padding: 10, borderRadius: 8, textAlign: 'center' },
  seconds: { color: '#aaa', marginLeft: 8 },
  rightSidebar: { width: 400, backgroundColor: '#0d0d0d', borderLeftWidth: 1, borderLeftColor: '#222' },
  summary: { flex: 1 },
  summaryTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
  summaryText: { color: '#ccc', fontSize: 16, marginBottom: 12 },
  warningText: { color: '#e74c3c', fontSize: 14, marginBottom: 12 },
  actionButtons: { gap: 12 },
  saveExitBtn: { backgroundColor: '#333', padding: 16, borderRadius: 12, alignItems: 'center' },
  saveHostBtn: { backgroundColor: '#00c781', padding: 16, borderRadius: 12, alignItems: 'center' },
  actionBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});