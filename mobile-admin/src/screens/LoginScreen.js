import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { authApi } from '../api';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function LoginScreen({ onLoginSuccess }) {
  const [adminKey, setAdminKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!adminKey) return setError('Please enter the admin key');
    
    setLoading(true);
    setError('');
    try {
      await authApi.login(adminKey);
      onLoginSuccess();
    } catch (err) {
      setError('Invalid admin key or network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>LoliShop Admin</Text>
        <Text style={styles.subtitle}>Enter your secret admin key to continue</Text>
        
        <TextInput
          style={styles.input}
          placeholder="Admin Key"
          secureTextEntry
          value={adminKey}
          onChangeText={setAdminKey}
          autoCapitalize="none"
        />
        
        {error ? <Text style={styles.error}>{error}</Text> : null}
        
        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Login</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#0f172a', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#64748b', textAlign: 'center', marginBottom: 32 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 16, fontSize: 16, marginBottom: 16 },
  error: { color: '#ef4444', marginBottom: 16, textAlign: 'center' },
  button: { backgroundColor: '#0f766e', padding: 16, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});
