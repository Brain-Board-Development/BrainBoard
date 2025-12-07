/**
 * CreateGameMenu.js
 * 
 * This screen lets a teacher **create a new quiz** or **edit an existing one**.
 *
 * Features
 *   • Title + tags (comma-separated)
 *   • Add / edit / delete questions
 *   • Two question types:
 *        – Multiple-Choice (up to 4 answers, any number can be correct)
 *        – True/False (fixed answers, exactly one correct)
 *   • Optional image upload for each question (web only)
 *   • Preview of every question with correct-answer highlighting
 *   • Save & Exit  →  back to the dashboard
 *   • Save & Host  →  go straight to the host screen
 *   • Confirmation dialogs for cancel / errors
 *
 * Navigation
 *   • Comes from TeacherDashboard
 *   • Receives:
 *        – `initialTitle`  (new game)
 *        – `gameId` + `gameData` (edit mode)
 *
 * Firebase
 *   • Firestore collection: **games**
 *   • Storage folder: **games/<uid>/...**
 * 
 */

import React, { useState, useEffect } from 'react';
import {
  View,               // Basic container
  Text,               // Simple text
  StyleSheet,         // CSS-like styling
  TouchableOpacity,   // Clickable button/area
  TextInput,          // Editable text field
  ScrollView,         // Scrollable area
  Modal,              // Pop-up overlay
  FlatList,           // Efficient list rendering
  ActivityIndicator,  // Loading spinner
  Image,              // Show images (local or remote)
} from 'react-native';

// Firebase config (must be set up in ../firebaseConfig)
import { db, auth, storage } from '../firebaseConfig';

// Firestore helpers
import {
  collection,   // Reference to a collection
  addDoc,       // Add a new document (returns ref)
  doc,          // Reference to a specific document
  updateDoc,    // Update an existing document
  getDoc,       // Read a document once
} from 'firebase/firestore';

// Storage helpers
import {
  ref,           // Reference to a file location
  uploadBytes,   // Upload raw bytes
  getDownloadURL,// Get public URL after upload
} from 'firebase/storage';

/* ------------------------------------------------------------------
 * MAIN COMPONENT
 * ------------------------------------------------------------------ */
export default function CreateGameMenu({ navigation, route }) {
  /* ----------------------------------------------------------------
   * 1. ROUTE PARAMETERS & INITIAL STATE
   * ---------------------------------------------------------------- */
  // If a title was passed from the dashboard (new game) use it,
  // otherwise fall back to the title of an existing game (edit mode)
  const initialTitle =
    route.params?.initialTitle || route.params?.gameData?.title || '';

  // ── Game-level fields ────────────────────────────────────────
  const [gameTitle, setGameTitle] = useState(initialTitle); // Visible title
  const [tags, setTags] = useState('');                     // CSV tags string
  const [questions, setQuestions] = useState([]);           // Array of question objects

  // ── Question modal state ───────────────────────────────────────
  const [isCreateQuestionModalVisible, setIsCreateQuestionModalVisible] =
    useState(false);                     // Show/hide the question editor
  const [editingQuestionIndex, setEditingQuestionIndex] = useState(null); // null = new, number = edit
  const [currentQuestion, setCurrentQuestion] = useState({
    type: 'multipleChoice',            // 'multipleChoice' | 'trueFalse'
    question: '',                      // The question text
    answers: ['', '', '', ''],         // Up to 4 answer strings (MC)
    correctAnswers: [false, false, false, false], // Booleans for each answer
    imageUrl: null,                    // Optional image URL
  });

  // ── UI helpers ───────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(false); // Global spinner
  const [isEditing, setIsEditing] = useState(false); // Edit vs Create mode
  const [hoveredButton, setHoveredButton] = useState(null); // Web hover effect
  const [hoveredEditTitle, setHoveredEditTitle] = useState(false); // Title edit icon hover
  const gameId = route.params?.gameId; // Firestore doc ID when editing

  // ── Confirmation / Alert modal ───────────────────────────────────
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    onCancel: () => {},
    showSaveOption: false, // true → shows Discard / Save / Resume
  });

  // ── Title edit modal ─────────────────────────────────────────────
  const [titleEditModal, setTitleEditModal] = useState({
    isOpen: false,
    currentTitle: '',
  });

  /* ----------------------------------------------------------------
   * 2. LOAD EXISTING GAME (EDIT MODE)
   * ---------------------------------------------------------------- */
  useEffect(() => {
    // Only run when a gameId is supplied (editing an existing game)
    if (gameId) {
      const loadGameData = async () => {
        try {
          setIsLoading(true);                         // Show spinner
          const gameDoc = await getDoc(doc(db, 'games', gameId));
          if (gameDoc.exists()) {
            const data = gameDoc.data();
            setGameTitle(data.title || '');
            setTags(data.tags ? data.tags.join(', ') : '');
            setQuestions(data.questions || []);
            setIsEditing(true);                       // Switch UI to "Edit"
          }
        } catch (error) {
          console.error('Error loading game:', error);
        } finally {
          setIsLoading(false);                        // Hide spinner
        }
      };
      loadGameData();
    }
  }, [gameId]); // Re-run only if gameId changes

  // If a title was passed for a *new* game, set it immediately
  useEffect(() => {
    if (route.params?.initialTitle && !gameId) {
      setGameTitle(route.params.initialTitle);
    }
  }, [route.params?.initialTitle, gameId]);

  /* ----------------------------------------------------------------
   * 3. HELPER FUNCTIONS (pure JS)
   * ---------------------------------------------------------------- */
  // Update the tags TextInput
  const handleTagsChange = (text) => setTags(text);

  // Convert "math, science, grade8" → ['math','science','grade8']
  const parseTags = () =>
    tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

  // Detect if a question has more than one correct answer
  const isMultiSelectQuestion = (question) =>
    question.correctAnswers.filter(Boolean).length > 1;

  /* ----------------------------------------------------------------
   * 4. QUESTION CRUD
   * ---------------------------------------------------------------- */
  // Open modal to create a brand-new question
  const addQuestion = () => {
    setEditingQuestionIndex(null);
    setCurrentQuestion({
      type: 'multipleChoice',
      question: '',
      answers: ['', '', '', ''],
      correctAnswers: [false, false, false, false],
      imageUrl: null,
    });
    setIsCreateQuestionModalVisible(true);
  };

  // Save the question that is currently being edited
  const saveQuestion = () => {
    // ---- Validation ------------------------------------------------
    if (!currentQuestion.question.trim()) {
      showAlert('Missing Question', 'Please enter a question.');
      return;
    }
    const correctCount = currentQuestion.correctAnswers.filter(Boolean).length;
    if (correctCount === 0) {
      showAlert('No Correct Answer', 'Please select at least one correct answer.');
      return;
    }

    // ---- Persist ---------------------------------------------------
    const questionData = { ...currentQuestion };
    if (editingQuestionIndex !== null) {
      // Editing an existing question
      const updated = [...questions];
      updated[editingQuestionIndex] = questionData;
      setQuestions(updated);
    } else {
      // Adding a new question
      setQuestions((prev) => [...prev, questionData]);
    }
    setIsCreateQuestionModalVisible(false); // Close modal
  };

  // Open modal with existing question data for editing
  const editQuestion = (index) => {
    setEditingQuestionIndex(index);
    setCurrentQuestion({ ...questions[index] });
    setIsCreateQuestionModalVisible(true);
  };

  // Remove a question from the list
  const deleteQuestion = (index) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  /* ----------------------------------------------------------------
   * 5. IMAGE UPLOAD (WEB ONLY)
   * ---------------------------------------------------------------- */
  const uploadImage = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const user = auth.currentUser;
      if (!user) {
        showAlert('Authentication Error', 'User not authenticated.');
        return;
      }

      // Build a unique file name
      const ext = file.name.split('.').pop();
      const name = `question-${Date.now()}.${ext}`;
      const storageRef = ref(storage, `games/${user.uid}/${name}`);

      // Upload raw bytes
      const snapshot = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(snapshot.ref);

      // Store the public URL in the current question
      setCurrentQuestion((prev) => ({ ...prev, imageUrl: url }));
      event.target.value = ''; // Reset file input
    } catch (error) {
      console.error('Image upload error:', error);
      showAlert('Upload Failed', `Failed to upload image: ${error.message}`);
    }
  };

  /* ----------------------------------------------------------------
   * 6. SAVE GAME TO FIRESTORE
   * ---------------------------------------------------------------- */
  const saveGame = async (shouldHost = false, onSuccess = () => {}) => {
    // ---- Basic validation -----------------------------------------
    if (!gameTitle.trim()) {
      showAlert('Missing Title', 'Please enter a game title.');
      return;
    }
    if (questions.length === 0) {
      showAlert('No Questions', 'Please add at least one question.');
      return;
    }

    try {
      const user = auth.currentUser;
      const gameData = {
        title: gameTitle,
        tags: parseTags(),
        questions,
        numQuestions: questions.length,
        creatorId: user.uid,
        updatedAt: new Date().toISOString(),
      };

      let savedGame;
      if (isEditing) {
        // UPDATE existing document
        await updateDoc(doc(db, 'games', gameId), gameData);
        savedGame = { id: gameId, ...gameData };
      } else {
        // CREATE new document
        const docRef = await addDoc(collection(db, 'games'), gameData);
        savedGame = { id: docRef.id, ...gameData };
      }

      const successMsg = shouldHost
        ? 'Game saved and ready to host!'
        : 'Game saved successfully!';

      // Show success alert, then run the appropriate navigation
      showAlert('Success', successMsg, () => {
        if (shouldHost) {
          navigation.navigate('HostGameMenu', { gameId: savedGame.id });
        } else {
          onSuccess();
        }
      });
    } catch (error) {
      console.error('Error saving game:', error);
      showAlert('Save Failed', 'Failed to save game.');
    }
  };

  // Convenience wrappers
  const saveAndExit = () => saveGame(false, () => navigation.goBack());
  const saveAndHost = () => saveGame(true);

  /* ----------------------------------------------------------------
   * 7. CANCEL WITH CONFIRMATION DIALOG
   * ---------------------------------------------------------------- */
  const handleCancel = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Cancel Editing?',
      message: 'Do you want to save your changes before leaving?',
      showSaveOption: true,
      onConfirm: () => {
        setConfirmModal({ ...confirmModal, isOpen: false });
        navigation.goBack(); // Discard
      },
      onCancel: () => setConfirmModal({ ...confirmModal, isOpen: false }), // Resume
      onSave: saveAndExit, // Save then exit
    });
  };

  /* ----------------------------------------------------------------
   * 8. UNIVERSAL ALERT (OK button only)
   * ---------------------------------------------------------------- */
  const showAlert = (title, message, onOk = () => {}) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      showSaveOption: false,
      onConfirm: () => {
        setConfirmModal({ ...confirmModal, isOpen: false });
        onOk();
      },
      onCancel: () => setConfirmModal({ ...confirmModal, isOpen: false }),
    });
  };

  /* ----------------------------------------------------------------
   * 9. DYNAMIC BUTTON STYLES (hover + disabled)
   * ---------------------------------------------------------------- */
  const isSaveValid = gameTitle.trim().length > 0 && questions.length > 0;

  const getCancelBtnStyle = () => [
    styles.cancelBtnBottom,
    {
      backgroundColor: hoveredButton === 'cancel' ? '#ff4d4d' : '#e74c3c',
    },
  ];

  const getSaveExitBtnStyle = () => [
    styles.saveExitBtn,
    {
      backgroundColor: isSaveValid
        ? hoveredButton === 'saveExit'
          ? '#00e092'
          : '#00c781'
        : '#666',
      opacity: isSaveValid ? 1 : 0.6,
    },
  ];

  const getSaveHostBtnStyle = () => [
    styles.saveHostBtn,
    { backgroundColor: hoveredButton === 'saveHost' ? '#00e092' : '#00c781' },
  ];

  /* ----------------------------------------------------------------
   * 10. ICON COMPONENT (correct / incorrect toggle)
   * ---------------------------------------------------------------- */
  const CorrectIcon = ({ isCorrect }) => (
    <Image
      source={
        isCorrect
          ? require('../assets/correct.png')
          : require('../assets/incorrect.png')
      }
      style={[
        styles.correctToggleIcon,
        { tintColor: isCorrect ? '#00c781' : '#e74c3c' },
      ]}
      resizeMode="contain"
    />
  );

  /* ----------------------------------------------------------------
   * 11. RENDER EACH QUESTION PREVIEW (FlatList item)
   * ---------------------------------------------------------------- */
  const renderQuestionPreview = ({ item, index }) => {
    const isMultiSelect = isMultiSelectQuestion(item);
    const displayType =
      item.type === 'trueFalse'
        ? 'True/False'
        : isMultiSelect
        ? 'Multi-Select'
        : 'Multiple Choice';

    return (
      <View style={styles.questionBlock}>
        {/* Header: question text + type + actions */}
        <View style={styles.questionHeader}>
          <View>
            <Text style={styles.questionText}>
              {item.question || 'Untitled Question'}
            </Text>
            <Text style={styles.questionTypeLabel}>{displayType}</Text>
          </View>
          <View style={styles.questionActions}>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => editQuestion(index)}
            >
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => deleteQuestion(index)}
            >
              <Text style={styles.deleteBtnText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Optional image preview */}
        {item.imageUrl && (
          <View style={styles.previewImageContainer}>
            <Image
              source={{ uri: item.imageUrl }}
              style={styles.previewImage}
              resizeMode="cover"
            />
          </View>
        )}

        {/* Answers list */}
        <View style={styles.answersContainer}>
          {item.type === 'trueFalse'
            ? // True/False always shows two rows
              item.answers.slice(0, 2).map((a, i) => (
                <View
                  key={i}
                  style={[
                    styles.answerOption,
                    item.correctAnswers[i] && styles.correctAnswer,
                  ]}
                >
                  <Text style={styles.answerText}>{a}</Text>
                </View>
              ))
            : // Multiple-Choice shows up to four rows
              item.answers.slice(0, 4).map((a, i) => (
                <View
                  key={i}
                  style={[
                    styles.answerOption,
                    item.correctAnswers[i] && styles.correctAnswer,
                  ]}
                >
                  <Text style={styles.answerText}>
                    {a || `Answer ${i + 1}`}
                  </Text>
                </View>
              ))}
        </View>
      </View>
    );
  };

  /* ----------------------------------------------------------------
   * 12. LOADING SCREEN
   * ---------------------------------------------------------------- */
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00c781" />
      </View>
    );
  }

  /* ----------------------------------------------------------------
   * 13. MAIN RENDER
   * ---------------------------------------------------------------- */
  return (
    <View style={styles.container}>
      {/* ====================== HEADER ====================== */}
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <Text style={styles.title}>
          {isEditing ? 'Edit Game' : 'Create a new game'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* ====================== SCROLLABLE CONTENT ====================== */}
      <ScrollView style={styles.mainContent}>
        {/* ---- SIDEBAR (fixed on the left) ---- */}
        <View style={styles.sidebar}>
          {/* Game Title (click pencil to edit) */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Game Title</Text>
            <View style={styles.titleRow}>
              <Text style={styles.titleLabel}>
                {gameTitle || 'Untitled Game'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setTitleEditModal({ isOpen: true, currentTitle: gameTitle });
                }}
                style={styles.editTitleBtn}
                onMouseEnter={() => setHoveredEditTitle(true)}
                onMouseLeave={() => setHoveredEditTitle(false)}
              >
                <Image
                  source={require('../assets/edit.png')}
                  style={[
                    styles.editIcon,
                    hoveredEditTitle && { tintColor: '#00c781' },
                  ]}
                  resizeMode="contain"
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Tags input */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Tags (comma separated)</Text>
            <TextInput
              style={styles.input}
              value={tags}
              onChangeText={handleTagsChange}
              placeholder="math, algebra, grade8"
              placeholderTextColor="#666"
            />
          </View>

          {/* Quick preview */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Preview</Text>
            <Text style={styles.previewText}>
              {gameTitle || 'Untitled Game'} • {questions.length} Questions
            </Text>
          </View>

          {/* Add question button */}
          <TouchableOpacity style={styles.createQuestionBtn} onPress={addQuestion}>
            <Text style={styles.createQuestionBtnText}>Create Question</Text>
          </TouchableOpacity>

          {/* Placeholder for future import feature */}
          <TouchableOpacity style={styles.importBtn}>
            <Text style={styles.importBtnText}>Import Questions</Text>
          </TouchableOpacity>
        </View>

        {/* ---- CENTER: LIST OF QUESTION PREVIEWS ---- */}
        <View style={styles.centerContent}>
          <FlatList
            data={questions}
            renderItem={renderQuestionPreview}
            keyExtractor={(_, i) => `q-${i}`}
            style={styles.questionsList}
            showsVerticalScrollIndicator={false}
          />
        </View>
      </ScrollView>

      {/* ====================== BOTTOM ACTION BAR ====================== */}
      <View style={styles.bottomActions}>
        <TouchableOpacity
          style={getCancelBtnStyle()}
          onPress={handleCancel}
          onMouseEnter={() => setHoveredButton('cancel')}
          onMouseLeave={() => setHoveredButton(null)}
        >
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={getSaveExitBtnStyle()}
          onPress={saveAndExit}
          disabled={!isSaveValid}
          onMouseEnter={() => setHoveredButton('saveExit')}
          onMouseLeave={() => setHoveredButton(null)}
        >
          <Text style={styles.saveExitBtnText}>
            {isEditing ? 'Update & Exit' : 'Save & Exit'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={getSaveHostBtnStyle()}
          onPress={saveAndHost}
          onMouseEnter={() => setHoveredButton('saveHost')}
          onMouseLeave={() => setHoveredButton(null)}
        >
          <Text style={styles.saveHostBtnText}>
            {isEditing ? 'Update & Host' : 'Save & Host'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ====================== TITLE EDIT MODAL ====================== */}
      <Modal
        visible={titleEditModal.isOpen}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setTitleEditModal((s) => ({ ...s, isOpen: false }))
        }
      >
        <View style={styles.modalOverlay}>
          <View style={styles.titleModal}>
            <Text style={styles.titleModalHeader}>Edit Title</Text>
            <TextInput
              style={styles.titleInput}
              placeholder="Enter a title..."
              placeholderTextColor="#999"
              value={titleEditModal.currentTitle}
              onChangeText={(t) =>
                setTitleEditModal((s) => ({ ...s, currentTitle: t }))
              }
              autoFocus
            />
            <View style={styles.titleModalButtons}>
              <TouchableOpacity
                style={styles.titleModalCancel}
                onPress={() =>
                  setTitleEditModal((s) => ({ ...s, isOpen: false }))
                }
              >
                <Text style={styles.titleModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.titleModalSave,
                  !titleEditModal.currentTitle.trim() && styles.disabledBtn,
                ]}
                onPress={() => {
                  const newTitle = titleEditModal.currentTitle.trim();
                  if (newTitle) {
                    setGameTitle(newTitle);
                    setTitleEditModal((s) => ({ ...s, isOpen: false }));
                  }
                }}
                disabled={!titleEditModal.currentTitle.trim()}
              >
                <Text style={styles.titleModalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ====================== QUESTION EDITOR MODAL ====================== */}
      <Modal
        visible={isCreateQuestionModalVisible}
        transparent
        animationType="slide"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.questionModal}>
            <Text style={styles.modalTitle}>
              {editingQuestionIndex !== null ? 'Edit Question' : 'Create Question'}
            </Text>

            {/* ---- Question Type Selector ---- */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Question Type</Text>
              <View style={styles.radioGroup}>
                {['multipleChoice', 'trueFalse'].map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.radioBtn,
                      currentQuestion.type === type && styles.radioBtnSelected,
                    ]}
                    onPress={() => {
                      setCurrentQuestion((prev) => ({
                        ...prev,
                        type,
                        ...(type === 'trueFalse'
                          ? {
                              answers: ['True', 'False'],
                              correctAnswers: [false, false],
                            }
                          : {
                              answers: ['', '', '', ''],
                              correctAnswers: [false, false, false, false],
                            }),
                      }));
                    }}
                  >
                    <Text style={styles.radioBtnText}>
                      {type === 'multipleChoice' ? 'Multiple Choice' : 'True/False'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* ---- Question Text ---- */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Question</Text>
              <TextInput
                style={styles.textarea}
                value={currentQuestion.question}
                onChangeText={(t) =>
                  setCurrentQuestion((p) => ({ ...p, question: t }))
                }
                placeholder="Enter your question here..."
                placeholderTextColor="#666"
                multiline
              />
            </View>

            {/* ---- Answers (MC or TF) ---- */}
            <View style={styles.answerContentContainer}>
              {/* Multiple-Choice answers */}
              {currentQuestion.type !== 'trueFalse' && (
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Answer Choices</Text>
                  {currentQuestion.answers.slice(0, 4).map((_, idx) => (
                    <View key={idx} style={styles.answerRow}>
                      <TextInput
                        style={styles.answerInput}
                        value={currentQuestion.answers[idx]}
                        onChangeText={(txt) =>
                          setCurrentQuestion((p) => ({
                            ...p,
                            answers: p.answers.map((a, i) =>
                              i === idx ? txt : a
                            ),
                          }))
                        }
                        placeholder={`Answer ${idx + 1}`}
                        placeholderTextColor="#666"
                      />
                      <TouchableOpacity
                        style={[
                          styles.correctToggle,
                          currentQuestion.correctAnswers[idx] &&
                            styles.correctToggleActive,
                        ]}
                        onPress={() =>
                          setCurrentQuestion((p) => ({
                            ...p,
                            correctAnswers: p.correctAnswers.map((c, i) =>
                              i === idx ? !c : c
                            ),
                          }))
                        }
                      >
                        <CorrectIcon
                          isCorrect={currentQuestion.correctAnswers[idx]}
                        />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* True/False answers (non-editable) */}
              {currentQuestion.type === 'trueFalse' && (
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Answer</Text>
                  {currentQuestion.answers.map((a, i) => (
                    <View key={i} style={styles.answerRow}>
                      <View style={styles.trueFalseAnswerBox}>
                        <Text style={styles.trueFalseAnswerText}>{a}</Text>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.correctToggle,
                          currentQuestion.correctAnswers[i] &&
                            styles.correctToggleActive,
                        ]}
                        onPress={() =>
                          setCurrentQuestion((p) => ({
                            ...p,
                            correctAnswers: p.correctAnswers.map((c, j) =>
                              j === i ? !c : false
                            ),
                          }))
                        }
                      >
                        <CorrectIcon
                          isCorrect={currentQuestion.correctAnswers[i]}
                        />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* ---- Image Upload (web only) ---- */}
            <div style={styles.uploadContainer}>
              <input
                type="file"
                accept="image/*"
                onChange={uploadImage}
                style={styles.hiddenFileInput}
                id="imageUpload"
              />
              <label htmlFor="imageUpload" style={styles.uploadBtn}>
                <Text style={styles.uploadBtnText}>Upload Image</Text>
              </label>
            </div>

            {/* Spacer to keep modal height stable */}
            <View style={styles.modalSpacer} />

            {/* ---- Modal Buttons ---- */}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setIsCreateQuestionModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveQuestionBtn}
                onPress={saveQuestion}
              >
                <Text style={styles.saveQuestionBtnText}>Save Question</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ====================== UNIVERSAL CONFIRM / ALERT MODAL ====================== */}
      <Modal
        visible={confirmModal.isOpen}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setConfirmModal({ ...confirmModal, isOpen: false })
        }
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <Text style={styles.confirmModalTitle}>{confirmModal.title}</Text>
            <Text style={styles.confirmModalText}>{confirmModal.message}</Text>

            <View style={styles.confirmModalButtons}>
              {confirmModal.showSaveOption ? (
                <>
                  {/* Discard changes */}
                  <TouchableOpacity
                    style={styles.confirmModalDiscard}
                    onPress={confirmModal.onConfirm}
                  >
                    <Text style={styles.confirmModalDiscardText}>
                      Discard Changes
                    </Text>
                  </TouchableOpacity>

                  {/* Save then exit */}
                  <TouchableOpacity
                    style={styles.confirmModalSave}
                    onPress={confirmModal.onSave}
                  >
                    <Text style={styles.confirmModalSaveText}>Save & Exit</Text>
                  </TouchableOpacity>

                  {/* Stay on screen */}
                  <TouchableOpacity
                    style={styles.confirmModalResume}
                    onPress={confirmModal.onCancel}
                  >
                    <Text style={styles.confirmModalResumeText}>
                      Resume Editing
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                /* Simple OK button */
                <TouchableOpacity
                  style={styles.confirmModalConfirm}
                  onPress={confirmModal.onConfirm}
                >
                  <Text style={styles.confirmModalConfirmText}>OK</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ================================================================
 * STYLESHEET – every property is explained
 * ================================================================ */
const styles = StyleSheet.create({
  /* ----------------------------------------------------------------
   * LAYOUT & CONTAINERS
   * ---------------------------------------------------------------- */
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111', // Dark background while loading
  },
  container: {
    flex: 1,
    backgroundColor: '#111', // Overall page background
  },

  /* ----------------------------------------------------------------
   * HEADER (top bar)
   * ---------------------------------------------------------------- */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#222',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  headerSpacer: {
    width: 100, // Empty space on left/right of title
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },

  /* ----------------------------------------------------------------
   * MAIN CONTENT AREA (scrollable)
   * ---------------------------------------------------------------- */
  mainContent: {
    flex: 1,
  },

  /* ----------------------------------------------------------------
   * SIDEBAR (fixed on the left side)
   * ---------------------------------------------------------------- */
  sidebar: {
    position: 'absolute',
    left: 20,
    top: 80,
    width: 300,
    zIndex: 10, // Stays above scrolling content
  },
  centerContent: {
    marginLeft: 340, // Leaves room for the sidebar
    padding: 20,
  },
  questionsList: {
    flexGrow: 1,
  },

  /* ----------------------------------------------------------------
   * FORM INPUTS & LABELS
   * ---------------------------------------------------------------- */
  formGroup: {
    marginBottom: 20,
    width: '100%',
  },
  label: {
    fontSize: 14,
    color: '#fff',
    marginBottom: 8,
    fontWeight: 'bold',
  },

  /* Title row (shows current title + edit icon) */
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#333',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
  },
  titleLabel: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
  },
  editTitleBtn: {
    padding: 4,
  },
  editIcon: {
    width: 20,
    height: 20,
    tintColor: '#888',
  },

  /* General text input */
  input: {
    backgroundColor: '#333',
    color: '#fff',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#444',
  },

  /* Quick preview box under the title/tags */
  previewText: {
    backgroundColor: '#333',
    color: '#ccc',
    padding: 12,
    borderRadius: 8,
    fontSize: 14,
  },

  /* ----------------------------------------------------------------
   * BUTTONS (sidebar)
   * ---------------------------------------------------------------- */
  createQuestionBtn: {
    backgroundColor: '#00c781',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  createQuestionBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  importBtn: {
    backgroundColor: '#666',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  importBtnText: {
    color: '#fff',
    fontSize: 16,
  },

  /* ----------------------------------------------------------------
   * QUESTION PREVIEW BLOCK (center column)
   * ---------------------------------------------------------------- */
  questionBlock: {
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  questionText: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginRight: 10,
  },
  questionTypeLabel: {
    fontSize: 12,
    color: '#00c781',
    marginTop: 4,
  },
  questionActions: {
    flexDirection: 'row',
  },
  editBtn: {
    backgroundColor: '#00c781',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginRight: 8,
  },
  editBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  deleteBtn: {
    backgroundColor: '#e74c3c',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  deleteBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },

  previewImageContainer: {
    marginBottom: 15,
  },
  previewImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
  },

  answersContainer: {
    marginTop: 10,
  },
  answerOption: {
    backgroundColor: '#333',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#444',
  },
  correctAnswer: {
    backgroundColor: '#00c781',
    borderColor: '#00a670',
  },
  answerText: {
    color: '#fff',
    fontSize: 14,
  },

  /* ----------------------------------------------------------------
   * BOTTOM ACTION BAR (fixed at the bottom)
   * ---------------------------------------------------------------- */
  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    backgroundColor: '#222',
    borderTopWidth: 1,
    borderTopColor: '#333',
    gap: 10,
  },
  cancelBtnBottom: {
    flex: 1,
    backgroundColor: '#e74c3c',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  saveExitBtn: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveExitBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  saveHostBtn: {
    flex: 1,
    backgroundColor: '#00c781',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveHostBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },

  /* ----------------------------------------------------------------
   * MODAL OVERLAY (darkens background)
   * ---------------------------------------------------------------- */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* ----------------------------------------------------------------
   * QUESTION EDITOR MODAL
   * ---------------------------------------------------------------- */
  questionModal: {
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 25,
    width: '28%',
    minHeight: 620,
    maxHeight: '85%',
    justifyContent: 'flex-start',
    overflow: 'hidden',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
    textAlign: 'center',
  },

  /* Radio-style type selector */
  radioGroup: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: 24,
    marginBottom: 15,
    paddingLeft: 2,
  },
  radioBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
    minWidth: 130,
  },
  radioBtnSelected: {
    backgroundColor: '#00c781',
    borderColor: '#00a670',
  },
  radioBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },

  /* Textarea for the question */
  textarea: {
    backgroundColor: '#333',
    color: '#fff',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#444',
    minHeight: 80,
    textAlignVertical: 'top',
  },

  /* Container that keeps MC and TF the same height */
  answerContentContainer: {
    flexGrow: 1,
    minHeight: 280,
    justifyContent: 'flex-start',
  },

  /* Row that holds an answer input + correct-toggle */
  answerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },

  /* MC answer input */
  answerInput: {
    flex: 1,
    backgroundColor: '#333',
    color: '#fff',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#444',
    marginRight: 10,
    fontSize: 16,
  },

  /* TF answer (non-editable) */
  trueFalseAnswerBox: {
    flex: 1,
    backgroundColor: '#333',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
    marginRight: 10,
    justifyContent: 'center',
  },
  trueFalseAnswerText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },

  /* Correct-toggle circle */
  correctToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#555',
  },
  correctToggleActive: {
    backgroundColor: '#00c781',
    borderColor: '#00a670',
  },
  correctToggleIcon: {
    width: 20,
    height: 20,
  },

  /* Image upload area (web only) */
  uploadContainer: {
    marginTop: 10,
    marginBottom: 20,
  },
  hiddenFileInput: {
    display: 'none',
  },
  uploadBtn: {
    display: 'inline-block',
    backgroundColor: '#666',
    padding: 12,
    borderRadius: 8,
    cursor: 'pointer',
    border: 'none',
  },
  uploadBtnText: {
    color: '#fff',
    fontSize: 14,
  },

  /* Spacer to keep modal height consistent */
  modalSpacer: {
    flexGrow: 1,
    minHeight: 20,
  },

  /* Modal button row */
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#666',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 10,
  },
  cancelBtnText: {
    color: '#fff',
    fontSize: 16,
  },
  saveQuestionBtn: {
    flex: 1,
    backgroundColor: '#00c781',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginLeft: 10,
  },
  saveQuestionBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },

  /* ----------------------------------------------------------------
   * CONFIRM / ALERT MODAL
   * ---------------------------------------------------------------- */
  confirmModal: {
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 20,
    width: 340,
    alignSelf: 'center',
  },
  confirmModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmModalText: {
    fontSize: 15,
    color: '#ccc',
    marginBottom: 20,
    lineHeight: 20,
    textAlign: 'center',
  },
  confirmModalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  confirmModalDiscard: {
    flex: 1,
    backgroundColor: '#e74c3c',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmModalDiscardText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  confirmModalSave: {
    flex: 1,
    backgroundColor: '#00c781',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmModalSaveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  confirmModalResume: {
    flex: 1,
    backgroundColor: '#666',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmModalResumeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  confirmModalConfirm: {
    flex: 1,
    backgroundColor: '#00c781',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmModalConfirmText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },

  /* ----------------------------------------------------------------
   * TITLE EDIT MODAL
   * ---------------------------------------------------------------- */
  titleModal: {
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 20,
    width: 340,
    alignSelf: 'center',
  },
  titleModalHeader: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  titleInput: {
    backgroundColor: '#333',
    color: '#fff',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 20,
  },
  titleModalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  titleModalCancel: {
    flex: 1,
    backgroundColor: '#444',
    paddingVertical: 10,
    marginRight: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  titleModalCancelText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  titleModalSave: {
    flex: 1,
    backgroundColor: '#00c781',
    paddingVertical: 10,
    marginLeft: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  titleModalSaveText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  disabledBtn: {
    opacity: 0.5,
  },
});