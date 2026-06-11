import axios from 'axios'

const apiClient = axios.create({
  baseURL: '/api',
  timeout: 120_000,
  headers: {
    'Content-Type': 'application/json',
  },
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message ||
      'Unbekannter Fehler'
    console.error('API Error:', message, error.response?.status)
    return Promise.reject(new Error(message))
  }
)

export default apiClient
