
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { io, Socket } from 'socket.io-client';

type Player = {
  id: string;
  name: string;
  score: number;
};

type Buzz = {
  id: string;
  name: string;
  time: number;
};

type RoomData = {
  players?: Player[];
  buzzes?: Buzz[];
  frozen?: boolean;
  round?: number;
};

type JoinResponse = {
  success: boolean;
  player?: Player;
  error?: string;
};

type ParsedGame =
  | { error: string }
  | { origin: string; code: string };

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.').map(Number);

  if (
    parts.length !== 4 ||
    parts.some(
      (part) => !Number.isInteger(part) || part < 0 || part > 255
    )
  ) {
    return false;
  }

  const [a, b] = parts;

  return (
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31)
  );
}

function parseGameQR(value: string): ParsedGame {
  try {
    const url = new URL(value);

    if (url.protocol !== 'http:') {
      return { error: 'This is not a valid Buzzer Host link.' };
    }

    if (url.username || url.password) {
      return { error: 'This QR code is not valid.' };
    }

    if (url.port !== '3000') {
      return { error: 'This does not look like a Buzzer Host link.' };
    }

    if (url.pathname !== '/' && url.pathname !== '/player') {
      return { error: 'This QR code does not point to a game.' };
    }

    if (!isPrivateIPv4(url.hostname)) {
      return {
        error: 'The game link must be on your local Wi-Fi network.',
      };
    }

    if (url.searchParams.get('app') !== 'buzzer-showdown') {
      return { error: 'This QR code is not for Buzzer Showdown.' };
    }

    const code = url.searchParams.get('room')?.trim();

    if (!code || code.length > 64) {
      return { error: 'The QR code is missing its room code.' };
    }

    return {
      origin: url.origin,
      code,
    };
  } catch {
    return { error: 'That QR code does not contain a valid link.' };
  }
}

export default function HomeScreen() {
  const [permission, requestPermission] = useCameraPermissions();

  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [result, setResult] = useState('');
  const [playerName, setPlayerName] = useState('');

  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [invalidQR, setInvalidQR] = useState(false);

  const [joined, setJoined] = useState(false);
  const [player, setPlayer] = useState<Player | null>(null);
  const [room, setRoom] = useState<RoomData>({});
  const [gameEnded, setGameEnded] = useState(false);

  const socketRef = useRef<Socket | null>(null);

  const hasBuzzed =
    !!player &&
    !!room.buzzes?.some((buzz) => buzz.id === player.id);

  const currentPlayer =
    room.players?.find((item) => item.id === player?.id) || player;

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  function handleScan(data: string) {
    setScanned(true);
    setScanning(false);
    setResult(data);
    setError('');

    const game = parseGameQR(data);

    if ('error' in game) {
      setInvalidQR(true);

      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Error
      ).catch(() => {});

      return;
    }

    setInvalidQR(false);
  }

  function disconnectFromGame() {
    socketRef.current?.disconnect();
    socketRef.current = null;

    setJoined(false);
    setConnecting(false);
    setPlayer(null);
    setRoom({});
    setGameEnded(false);
  }

  function scanAgain() {
    disconnectFromGame();
    setResult('');
    setPlayerName('');
    setError('');
    setInvalidQR(false);
    setScanned(false);
  }

  function joinGame() {
    const name = playerName.trim();

    if (!name) {
      setError('Please enter a player name.');
      return;
    }

    const game = parseGameQR(result);

    if ('error' in game) {
      setInvalidQR(true);
      setError(game.error);

      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Error
      ).catch(() => {});

      return;
    }

    disconnectFromGame();
    setError('');
    setConnecting(true);

    const socket = io(game.origin, {
      timeout: 10000,
      reconnection: false,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit(
        'join-room',
        {
          code: game.code,
          name,
        },
        (response: JoinResponse) => {
          setConnecting(false);

          if (!response?.success || !response.player) {
            setError(response?.error || 'Could not join this game.');
            socket.disconnect();
            socketRef.current = null;
            return;
          }

          setPlayer(response.player);
          setJoined(true);
          setGameEnded(false);
        }
      );
    });

    socket.on('room-update', (updatedRoom: RoomData) => {
      setRoom(updatedRoom);
    });

    socket.on('room-ended', () => {
      setGameEnded(true);
      setJoined(false);
      setConnecting(false);
      socket.disconnect();
      socketRef.current = null;
    });

    socket.on('connect_error', () => {
      setConnecting(false);
      setError(
        'Could not connect to Buzzer Host. Make sure the host is running and both devices are on the same Wi-Fi.'
      );

      socket.disconnect();
      socketRef.current = null;
    });
  }

  function sendBuzz() {
    if (!socketRef.current || !player || room.frozen || hasBuzzed) {
      return;
    }

    const game = parseGameQR(result);

    if ('error' in game) {
      setInvalidQR(true);
      setError(game.error);
      return;
    }

    socketRef.current.emit('buzz', {
      code: game.code,
    });
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.brand}>BUZZER</Text>
        <Text style={styles.brandGold}>SHOWDOWN</Text>
        <Text style={styles.subtitle}>MOBILE EDITION</Text>
      </View>

      {!scanning && !result && !joined && !connecting && (
        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <Text style={styles.qrIcon}>▦</Text>
          </View>

          <Text style={styles.heading}>Ready to play?</Text>
          <Text style={styles.description}>
            Scan the QR code displayed on your Buzzer Host to join a game.
          </Text>

          <Pressable
            style={styles.button}
            onPress={() => {
              setScanned(false);
              setScanning(true);
              setError('');
            }}
          >
            <Text style={styles.buttonText}>SCAN TO JOIN</Text>
          </Pressable>

          <Text style={styles.footer}>
            POWERED BY BUZZERSHOWDOWN-DEV
          </Text>
        </View>
      )}

      {scanning && (
        <View style={styles.content}>
          <Text style={styles.heading}>Scan QR Code</Text>
          <Text style={styles.description}>
            Point your camera at the game QR code.
          </Text>

          {!permission ? (
            <ActivityIndicator color="#F8C746" />
          ) : !permission.granted ? (
            <Pressable style={styles.button} onPress={requestPermission}>
              <Text style={styles.buttonText}>ALLOW CAMERA</Text>
            </Pressable>
          ) : (
            <View style={styles.cameraContainer}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={
                  scanned ? undefined : ({ data }) => handleScan(data)
                }
              />
            </View>
          )}

          <Pressable
            style={styles.secondaryButton}
            onPress={() => setScanning(false)}
          >
            <Text style={styles.secondaryText}>CANCEL</Text>
          </Pressable>
        </View>
      )}

      {invalidQR && !joined && (
        <View style={styles.content}>
          <View style={styles.invalidIcon}>
            <Text style={styles.invalidIconText}>!</Text>
          </View>

          <Text style={styles.invalidHeading}>INVALID QR CODE</Text>

          <Text style={styles.description}>
            This isn't a valid Buzzer Showdown QR code.
            Please scan the QR code displayed by Buzzer Host.
          </Text>

          <Pressable style={styles.button} onPress={scanAgain}>
            <Text style={styles.buttonText}>SCAN AGAIN</Text>
          </Pressable>
        </View>
      )}

      {!!result && !invalidQR && !joined && !connecting && !gameEnded && (
        <View style={styles.content}>
          <Text style={styles.heading}>QR Code Found!</Text>
          <Text style={styles.description}>
            Enter your player name to join the game.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Your player name"
            placeholderTextColor="#888"
            value={playerName}
            onChangeText={setPlayerName}
            maxLength={20}
            autoCapitalize="words"
          />

          <Text style={styles.resultText} numberOfLines={2}>
            {result}
          </Text>

          {!!error && <Text style={styles.errorText}>{error}</Text>}

          <Pressable
            style={[
              styles.button,
              !playerName.trim() && styles.disabled,
            ]}
            disabled={!playerName.trim()}
            onPress={joinGame}
          >
            <Text style={styles.buttonText}>JOIN GAME</Text>
          </Pressable>

          <Pressable
            style={styles.secondaryButton}
            onPress={scanAgain}
          >
            <Text style={styles.secondaryText}>SCAN AGAIN</Text>
          </Pressable>
        </View>
      )}

      {connecting && (
        <View style={styles.content}>
          <ActivityIndicator size="large" color="#F8C746" />
          <Text style={styles.heading}>Connecting...</Text>
          <Text style={styles.description}>
            Finding your Buzzer Host and joining the game.
          </Text>
        </View>
      )}

      {joined && !gameEnded && (
        <View style={styles.gameContent}>
          <Text style={styles.gameHeading}>YOU'RE IN!</Text>

          <Text style={styles.playerLabel}>
            Playing as {currentPlayer?.name}
          </Text>

          <View style={styles.scorePanel}>
            <Text style={styles.scoreLabel}>YOUR SCORE</Text>
            <Text style={styles.score}>
              {currentPlayer?.score ?? 0}
            </Text>
            <Text style={styles.roundLabel}>
              ROUND {room.round ?? 1}
            </Text>
          </View>

          <Pressable
            style={[
              styles.buzzer,
              (room.frozen || hasBuzzed) && styles.buzzerDisabled,
            ]}
            disabled={!!room.frozen || hasBuzzed}
            onPress={sendBuzz}
          >
            <Text style={styles.buzzerText}>
              {room.frozen
                ? 'LOCKED'
                : hasBuzzed
                  ? 'BUZZED!'
                  : 'BUZZ!'}
            </Text>
          </Pressable>

          <Text style={styles.buzzerHint}>
            {room.frozen
              ? 'The host has frozen the buzzers.'
              : hasBuzzed
                ? 'Your buzz has been sent!'
                : 'Tap the button when you know the answer.'}
          </Text>

          <View style={styles.playersPanel}>
            <Text style={styles.playersHeading}>
              PLAYERS ({room.players?.length ?? 1})
            </Text>

            {(room.players ?? (player ? [player] : [])).map((item) => (
              <View key={item.id} style={styles.playerRow}>
                <Text style={styles.playerName}>{item.name}</Text>
                <Text style={styles.playerScore}>{item.score} pts</Text>
              </View>
            ))}
          </View>

          <Pressable
            style={styles.secondaryButton}
            onPress={scanAgain}
          >
            <Text style={styles.secondaryText}>LEAVE GAME</Text>
          </Pressable>
        </View>
      )}

      {gameEnded && (
        <View style={styles.content}>
          <Text style={styles.heading}>Game Over!</Text>
          <Text style={styles.description}>
            The host has ended the game.
          </Text>

          <Pressable style={styles.button} onPress={scanAgain}>
            <Text style={styles.buttonText}>BACK TO HOME</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080713',
  },
  header: {
    alignItems: 'center',
    paddingTop: 25,
    gap: 2,
  },
  brand: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 3,
  },
  brandGold: {
    color: '#F8C746',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 3,
  },
  subtitle: {
    color: '#9992A8',
    fontSize: 11,
    letterSpacing: 4,
    marginTop: 9,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  iconCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#19152A',
    borderWidth: 2,
    borderColor: '#F8C746',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  qrIcon: {
    color: '#F8C746',
    fontSize: 65,
    fontWeight: 'bold',
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 27,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
  },
  description: {
    color: '#AAA5B6',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 23,
    marginBottom: 30,
  },
  button: {
    backgroundColor: '#F8C746',
    paddingVertical: 19,
    paddingHorizontal: 35,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: '#080713',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  disabled: {
    opacity: 0.4,
  },
  secondaryButton: {
    padding: 16,
    marginTop: 12,
  },
  secondaryText: {
    color: '#F8C746',
    fontWeight: '700',
    letterSpacing: 1,
  },
  footer: {
    color: '#625D70',
    fontSize: 10,
    letterSpacing: 1.5,
    position: 'absolute',
    bottom: 25,
  },
  cameraContainer: {
    width: '100%',
    height: 330,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#F8C746',
  },
  camera: {
    flex: 1,
  },
  input: {
    width: '100%',
    backgroundColor: '#19152A',
    color: '#FFFFFF',
    padding: 17,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#39334D',
    marginBottom: 15,
    fontSize: 16,
  },
  resultText: {
    color: '#AAA5B6',
    fontSize: 12,
    marginBottom: 15,
    textAlign: 'center',
  },
  errorText: {
    color: '#FF7777',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 15,
  },
  invalidIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#351923',
    borderWidth: 2,
    borderColor: '#FF626C',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 25,
  },
  invalidIconText: {
    color: '#FF626C',
    fontSize: 65,
    fontWeight: '900',
  },
  invalidHeading: {
    color: '#FF626C',
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 15,
    textAlign: 'center',
  },
  gameContent: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 25,
  },
  gameHeading: {
    color: '#F8C746',
    fontSize: 29,
    fontWeight: '900',
    letterSpacing: 2,
  },
  playerLabel: {
    color: '#AAA5B6',
    fontSize: 15,
    marginTop: 5,
  },
  scorePanel: {
    width: '100%',
    backgroundColor: '#19152A',
    borderRadius: 16,
    alignItems: 'center',
    padding: 14,
    marginTop: 20,
    marginBottom: 18,
  },
  scoreLabel: {
    color: '#AAA5B6',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
  },
  score: {
    color: '#F8C746',
    fontSize: 38,
    fontWeight: '900',
  },
  roundLabel: {
    color: '#AAA5B6',
    fontSize: 11,
    letterSpacing: 2,
  },
  buzzer: {
    width: 205,
    height: 205,
    borderRadius: 110,
    backgroundColor: '#F8C746',
    borderWidth: 9,
    borderColor: '#D7A92E',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 10,
  },
  buzzerDisabled: {
    backgroundColor: '#625D70',
    borderColor: '#494456',
  },
  buzzerText: {
    color: '#080713',
    fontSize: 29,
    fontWeight: '900',
    letterSpacing: 2,
  },
  buzzerHint: {
    color: '#AAA5B6',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 18,
  },
  playersPanel: {
    width: '100%',
    backgroundColor: '#19152A',
    borderRadius: 14,
    padding: 14,
    maxHeight: 150,
  },
  playersHeading: {
    color: '#F8C746',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  playerName: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  playerScore: {
    color: '#AAA5B6',
    fontSize: 13,
  },
});
