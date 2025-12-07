import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import HomeScreen from './screens/HomeScreen';
import JoinGameScreen from './screens/JoinGameScreen';
import JoinGameScreenMobile from './screens/JoinGameScreenMobile';
import LoginScreen from './screens/LoginScreen';
import SignUpScreen from './screens/SignUpScreen';
import ResetPassword from './screens/ResetPassword';
import TeacherDashboard from './screens/TeacherDashboard.js'; // Added for Teacher navigation
import StudentDashboard from './screens/StudentDashboard.js';
import CreateGameMenu from './screens/CreateGameMenu.js';

const Stack = createStackNavigator();

export default function App() {
  const [initialRouteName, setInitialRouteName] = useState(
    Platform.OS === 'web' ? 'Home' : 'JoinGameScreenMobile'
  );

  useEffect(() => {
    // Configure Google Sign-In
    GoogleSignin.configure({
      webClientId: '1:1045244308839:web:76ce638e01a27c933f13c2', // Replace with your Firebase Web Client ID
      iosClientId: 'YOUR_IOS_CLIENT_ID', // Optional, replace with your iOS Client ID
      offlineAccess: true,
    });

    // Check for existing user token to determine initial route
    const checkAuthState = async () => {
      try {
        const userToken = await AsyncStorage.getItem('userToken');
        if (userToken) {
          // Optionally verify token with Firebase if needed
          setInitialRouteName('Home'); // Or 'TeacherDashboard' based on user data
        }
      } catch (error) {
        console.error('Error checking auth state:', error);
      }
    };

    checkAuthState();
  }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={initialRouteName}
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="JoinGameScreen" component={JoinGameScreen} />
        <Stack.Screen name="JoinGameScreenMobile" component={JoinGameScreenMobile} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen
          name="SignUp"
          component={SignUpScreen}
          initialParams={{ startScreen: 'AccountTypeScreen' }}
        />
        <Stack.Screen name="ResetPassword" component={ResetPassword} />
        <Stack.Screen name="TeacherDashboard" component={TeacherDashboard} />
        <Stack.Screen name="StudentDashboard" component={StudentDashboard} />
        <Stack.Screen name="CreateGameMenu" component={CreateGameMenu} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}