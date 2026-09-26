import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const API_BASE_URL = 'https://lolishop-manage.onrender.com/api';
const ADMIN_KEY_STORAGE = 'admin_api_key';

export const api = axios.create({
  baseURL: API_BASE_URL,
});

// Interceptor to attach the admin key to every request
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(ADMIN_KEY_STORAGE);
  if (token) {
    config.headers['x-admin-key'] = token;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

export const authApi = {
  login: async (adminKey) => {
    // We can test if the key is valid by making a simple request to an admin-protected route.
    // For example, fetching the dashboard stats or just an admin ping if it exists.
    // We will use the GET /api/orders endpoint with a limit of 1 just to verify the key.
    const response = await axios.get(`${API_BASE_URL}/orders?limit=1`, {
      headers: { 'x-admin-key': adminKey }
    });

    // If successful, store the key
    await SecureStore.setItemAsync(ADMIN_KEY_STORAGE, adminKey);
    return true;
  },

  logout: async () => {
    await SecureStore.deleteItemAsync(ADMIN_KEY_STORAGE);
  },

  hasKey: async () => {
    const token = await SecureStore.getItemAsync(ADMIN_KEY_STORAGE);
    return !!token;
  }
};

export const ordersApi = {
  getOrders: () => api.get('/orders'),
  updateStatus: (orderIds, action) => api.post(`/orders/${action}/batch`, { orderIds }),
};

export const productsApi = {
  getProducts: () => api.get('/products?admin=true'),
};
