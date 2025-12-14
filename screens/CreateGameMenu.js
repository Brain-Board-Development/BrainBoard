/**
 * CreateGameMenu.js - Reimagined Modern Version
 * Three-column layout with embedded editor
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { db, auth, storage } from '../firebaseConfig';
import {
  doc,
  getDoc,
  addDoc,
  updateDoc,
  collection,
} from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';

const reorder = (list, startIndex, endIndex) => {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
};

export default function CreateGameMenu({ navigation, route }) {
  const gameId = route.params?.gameId;
  const initialTitle = route.params?.initialTitle || '';

  const [gameTitle, setGameTitle] = useState(initialTitle);
  const [coverImage, setCoverImage] = useState(null);
  const [tags, setTags] = useState('');
  const [questions, setQuestions] = useState([]);
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const currentQuestion = questions[selectedQuestionIndex] || {
    type: 'multipleChoice',
    question: '',
    answers: ['', '', '', ''],
    correctAnswers: [false, false, false, false],
    imageUrl: null,
    timeLimit: 20,
    points: 'standard',
  };

  useEffect(() => {
    if (gameId) {
      const loadGame = async () => {
        setIsLoading(true);
        const docSnap = await getDoc(doc(db, 'games', gameId));
        if (docSnap.exists()) {
          const data = docSnap.data();
          setGameTitle(data.title || '');
          setTags(data.tags?.join(', ') || '');
          setQuestions(data.questions || []);
          setCoverImage(data.coverImage || null);
          setIsEditing(true);
        }
        setIsLoading(false);
      };
      loadGame();
    }
  }, [gameId]);

  const updateCurrentQuestion = (updates) => {
    setQuestions(prev => {
      const updated = [...prev];
      updated[selectedQuestionIndex] = { ...updated[selectedQuestionIndex], ...updates };
      return updated;
    });
  };

  const addQuestion = () => {
    const newQ = {
      type: 'multipleChoice',
      question: '',
      answers: ['', '', '', ''],
      correctAnswers: [false, false, false, false],
      imageUrl: null,
      timeLimit: 20,
      points: 'standard',
    };
    setQuestions(prev => [...prev, newQ]);
    setSelectedQuestionIndex(questions.length);
  };

  const deleteQuestion = (index) => {
    setQuestions(prev => prev.filter((_, i) => i !== index));
    if (selectedQuestionIndex >= questions.length - 1) {
      setSelectedQuestionIndex(Math.max(0, questions.length - 2));
    }
  };

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const reordered = reorder(questions, result.source.index, result.destination.index);
    setQuestions(reordered);
  };

  const uploadImage = async (e, isCover = false) => {
    const file = e.target.files[0];
    if (!file) return;

    const user = auth.currentUser;
    if (!user) return;

    const ext = file.name.split('.').pop();
    const name = `${isCover ? 'cover' : 'question'}-${Date.now()}.${ext}`;
    const storagePath = `games/${user.uid}/${name}`;
    const storageRefPath = ref(storage, storagePath);

    try {
      const snapshot = await uploadBytes(storageRefPath, file);
      const url = await getDownloadURL(snapshot.ref);
      if (isCover) {
        setCoverImage(url);
      } else {
        updateCurrentQuestion({ imageUrl: url });
      }
    } catch (err) {
      console.error('Upload failed', err);
    }
  };

  const saveGame = async (host = false) => {
    if (!gameTitle.trim() || questions.length === 0) return;

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
        const ref = await addDoc(collection(db, 'games'), gameData);
        savedId = ref.id;
      }
      if (host) {
        navigation.navigate('HostGameMenu', { gameId: savedId });
      } else {
        navigation.goBack();
      }
    } catch (err) {
      console.error('Save failed', err);
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
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEditing ? 'Edit Game' : 'Create Game'}</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Cover & Title */}
      <View style={styles.coverSection}>
        <TouchableOpacity style={styles.coverUpload}>
          {coverImage ? (
            <Image source={{ uri: coverImage }} style={styles.coverImage} />
          ) : (
            <Text style={styles.coverPlaceholder}>+ Add Cover Image</Text>
          )}
          <input type="file" accept="image/*" onChange={(e) => uploadImage(e, true)} style={{ display: 'none' }} id="coverUpload" />
          <label htmlFor="coverUpload" style={styles.coverOverlay}>
            <Text style={styles.coverOverlayText}>Upload</Text>
          </label>
        </TouchableOpacity>
        <View style={styles.titleSection}>
          <TextInput
            style={styles.gameTitleInput}
            value={gameTitle}
            onChangeText={setGameTitle}
            placeholder="Enter game title..."
            placeholderTextColor="#666"
          />
          <TextInput
            style={styles.tagsInput}
            value={tags}
            onChangeText={setTags}
            placeholder="Tags (comma separated)"
            placeholderTextColor="#666"
          />
        </View>
      </View>

      {/* Three Column Layout */}
      <DragDropContext onDragEnd={onDragEnd}>
        <View style={styles.mainLayout}>
          {/* Left: Question Navigator */}
          <View style={styles.leftSidebar}>
            <TouchableOpacity style={styles.addQuestionBtn} onPress={addQuestion}>
              <Text style={styles.addQuestionText}>+ Add Question</Text>
            </TouchableOpacity>
            <Droppable droppableId="questions">
              {(provided) => (
                <View {...provided.droppableProps} ref={provided.innerRef} style={styles.questionList}>
                  {questions.map((q, i) => (
                    <Draggable key={i} draggableId={`q-${i}`} index={i}>
                      {(provided, snapshot) => (
                        <View
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          style={[
                            styles.questionThumb,
                            snapshot.isDragging && styles.questionThumbDragging,
                            selectedQuestionIndex === i && styles.questionThumbSelected,
                          ]}
                          onPress={() => setSelectedQuestionIndex(i)}
                        >
                          <Text style={styles.thumbNumber}>{i + 1}</Text>
                          <Text style={styles.thumbText} numberOfLines={2}>
                            {q.question || 'New Question'}
                          </Text>
                        </View>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </View>
              )}
            </Droppable>
          </View>

          {/* Center: Question Editor */}
          <ScrollView style={styles.centerEditor}>
            <Text style={styles.editorLabel}>Question {selectedQuestionIndex + 1}</Text>
            <TextInput
              style={styles.questionInput}
              value={currentQuestion.question}
              onChangeText={(t) => updateCurrentQuestion({ question: t })}
              placeholder="Enter your question..."
              multiline
            />

            {/* Image */}
            {currentQuestion.imageUrl ? (
              <Image source={{ uri: currentQuestion.imageUrl }} style={styles.questionImage} />
            ) : (
              <TouchableOpacity style={styles.imageUpload}>
                <Text style={styles.imageUploadText}>+ Add Image</Text>
                <input type="file" accept="image/*" onChange={uploadImage} style={{ display: 'none' }} id="questionImage" />
                <label htmlFor="questionImage" style={styles.imageOverlay} />
              </TouchableOpacity>
            )}

            {/* Answer Choices */}
            {currentQuestion.type === 'multipleChoice' ? (
              currentQuestion.answers.map((ans, i) => (
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
                    style={[
                      styles.correctToggle,
                      currentQuestion.correctAnswers[i] && styles.correctToggleActive,
                    ]}
                    onPress={() => {
                      const newCorrect = [...currentQuestion.correctAnswers];
                      newCorrect[i] = !newCorrect[i];
                      updateCurrentQuestion({ correctAnswers: newCorrect });
                    }}
                  >
                    <Text style={styles.toggleIcon}>✓</Text>
                  </TouchableOpacity>
                </View>
              ))
            ) : (
              <View style={styles.trueFalseRow}>
                {['True', 'False'].map((label, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.tfBtn,
                      currentQuestion.correctAnswers[i] && styles.tfBtnCorrect,
                    ]}
                    onPress={() => updateCurrentQuestion({ correctAnswers: i === 0 ? [true, false] : [false, true] })}
                  >
                    <Text style={styles.tfText}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Time & Points */}
            <View style={styles.settingsRow}>
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
              <View style={styles.pointsSetting}>
                <Text style={styles.settingLabel}>Points</Text>
                <TouchableOpacity style={styles.pointsBtn}>
                  <Text style={styles.pointsText}>{currentQuestion.points}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>

          {/* Right: Game Settings & Preview */}
          <View style={styles.rightSidebar}>
            <Text style={styles.previewTitle}>Live Preview</Text>
            <View style={styles.previewCard}>
              <Text style={styles.previewQuestion}>{currentQuestion.question || 'Your question appears here'}</Text>
              {currentQuestion.imageUrl && <View style={styles.previewImagePlaceholder} />}
              <View style={styles.previewAnswers}>
                {(currentQuestion.type === 'trueFalse' ? ['True', 'False'] : currentQuestion.answers).map((a, i) => (
                  <View key={i} style={styles.previewAnswer}>
                    <Text style={styles.previewAnswerText}>{a || `Answer ${i + 1}`}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.summary}>
              <Text style={styles.summaryTitle}>Game Summary</Text>
              <Text style={styles.summaryText}>{questions.length} questions</Text>
              <Text style={styles.summaryText}>Est. time: ~{questions.reduce((acc, q) => acc + q.timeLimit, 0) / 60} min</Text>
            </View>

            <View style={styles.actionButtons}>
              <TouchableOpacity style={styles.saveExitBtn} onPress={() => saveGame(false)}>
                <Text style={styles.actionBtnText}>Save & Exit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveHostBtn} onPress={() => saveGame(true)}>
                <Text style={styles.actionBtnText}>Save & Host</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </DragDropContext>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: '#0d0d0d', borderBottomWidth: 1, borderBottomColor: '#222' },
  backBtn: { color: '#00c781', fontSize: 18, fontWeight: 'bold' },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  coverSection: { flexDirection: 'row', padding: 30, gap: 30, backgroundColor: '#0d0d0d' },
  coverUpload: { width: 200, height: 200, backgroundColor: '#1e1e1e', borderRadius: 16, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  coverImage: { width: '100%', height: '100%', borderRadius: 16 },
  coverPlaceholder: { color: '#666', fontSize: 16 },
  coverOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', borderRadius: 16 },
  coverOverlayText: { color: '#fff', fontWeight: 'bold' },
  titleSection: { flex: 1, justifyContent: 'center' },
  gameTitleInput: { fontSize: 36, fontWeight: 'bold', color: '#fff', backgroundColor: 'transparent', borderBottomWidth: 2, borderBottomColor: '#00c781', paddingBottom: 10, marginBottom: 20 },
  tagsInput: { fontSize: 16, color: '#aaa', backgroundColor: '#222', padding: 12, borderRadius: 8 },
  mainLayout: { flex: 1, flexDirection: 'row' },
  leftSidebar: { width: 300, backgroundColor: '#0d0d0d', padding: 20, borderRightWidth: 1, borderRightColor: '#222' },
  addQuestionBtn: { backgroundColor: '#00c781', padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 20 },
  addQuestionText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  questionList: { flex: 1 },
  questionThumb: { backgroundColor: '#1e1e1e', borderRadius: 12, padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
  questionThumbDragging: { opacity: 0.8 },
  questionThumbSelected: { borderColor: '#00c781', backgroundColor: '#003322' },
  thumbNumber: { color: '#00c781', fontWeight: 'bold', marginRight: 12, fontSize: 16 },
  thumbText: { color: '#fff', flex: 1 },
  centerEditor: { flex: 1, padding: 40, backgroundColor: '#111' },
  editorLabel: { fontSize: 18, color: '#aaa', marginBottom: 20 },
  questionInput: { fontSize: 28, color: '#fff', backgroundColor: '#1e1e1e', padding: 20, borderRadius: 16, minHeight: 120, marginBottom: 20 },
  imageUpload: { height: 200, backgroundColor: '#1e1e1e', borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 20, position: 'relative' },
  imageUploadText: { color: '#666', fontSize: 16 },
  imageOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  questionImage: { width: '100%', height: 200, borderRadius: 16, marginBottom: 20 },
  answerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  answerInput: { flex: 1, backgroundColor: '#1e1e1e', color: '#fff', padding: 16, borderRadius: 12, fontSize: 18 },
  correctToggle: { width: 50, height: 50, backgroundColor: '#333', borderRadius: 25, marginLeft: 12, justifyContent: 'center', alignItems: 'center' },
  correctToggleActive: { backgroundColor: '#00c781' },
  toggleIcon: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  trueFalseRow: { flexDirection: 'row', gap: 20, marginBottom: 20 },
  tfBtn: { flex: 1, backgroundColor: '#1e1e1e', padding: 20, borderRadius: 16, alignItems: 'center' },
  tfBtnCorrect: { backgroundColor: '#00c781' },
  tfText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  settingsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 30 },
  timeSetting: { flexDirection: 'row', alignItems: 'center' },
  settingLabel: { color: '#aaa', marginRight: 12 },
  timeInput: { backgroundColor: '#1e1e1e', color: '#fff', width: 60, padding: 10, borderRadius: 8, textAlign: 'center' },
  seconds: { color: '#aaa', marginLeft: 8 },
  pointsSetting: { flexDirection: 'row', alignItems: 'center' },
  pointsBtn: { backgroundColor: '#1e1e1e', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  pointsText: { color: '#fff' },
  rightSidebar: { width: 400, backgroundColor: '#0d0d0d', padding: 30, borderLeftWidth: 1, borderLeftColor: '#222' },
  previewTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
  previewCard: { backgroundColor: '#1e1e1e', borderRadius: 16, padding: 20, marginBottom: 30 },
  previewQuestion: { fontSize: 24, color: '#fff', marginBottom: 20 },
  previewImagePlaceholder: { height: 150, backgroundColor: '#333', borderRadius: 12, marginBottom: 20 },
  previewAnswers: { gap: 12 },
  previewAnswer: { backgroundColor: '#333', padding: 20, borderRadius: 12 },
  previewAnswerText: { color: '#fff', fontSize: 18 },
  summary: { marginBottom: 40 },
  summaryTitle: { fontSize: 18, color: '#aaa', marginBottom: 12 },
  summaryText: { color: '#ccc', fontSize: 16, marginBottom: 8 },
  actionButtons: { gap: 12 },
  saveExitBtn: { backgroundColor: '#333', padding: 16, borderRadius: 12, alignItems: 'center' },
  saveHostBtn: { backgroundColor: '#00c781', padding: 16, borderRadius: 12, alignItems: 'center' },
  actionBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});