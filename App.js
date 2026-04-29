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
import Dashboard from './screens/Dashboard';
import CreateGameMenu from './screens/CreateGameMenu.js';
import HostGameMenu from './screens/HostGameMenu.js';
import Lobby from './screens/Lobby.js';
import GameScreen from './screens/GameScreen.js';
import BoardGameScreen from './screens/BoardgameScreen';
import SoloQuiz from './screens/SoloQuiz';

const Stack = createStackNavigator();

export default function App() {
  const [initialRouteName, setInitialRouteName] = useState(
    Platform.OS === 'web' ? 'Home' : 'JoinGameScreenMobile'
  );

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: '1:1045244308839:web:76ce638e01a27c933f13c2',
      iosClientId: 'YOUR_IOS_CLIENT_ID',
      offlineAccess: true,
    });

    const checkAuthState = async () => {
      try {
        const userToken = await AsyncStorage.getItem('userToken');
        if (userToken) {
          setInitialRouteName('Home');
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
        <Stack.Screen name="Dashboard" component={Dashboard} />
        <Stack.Screen name="CreateGameMenu" component={CreateGameMenu} />
        <Stack.Screen name="HostGameMenu" component={HostGameMenu} />
        <Stack.Screen name="Lobby" component={Lobby} />
        <Stack.Screen name="GameScreen" component={GameScreen} />
        <Stack.Screen name="BoardGameScreen" component={BoardGameScreen} />
        <Stack.Screen name="SoloQuiz" component={SoloQuiz} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}