// Export Axios HTTP client
import axios from "axios";

export const HttpClient = axios.create({
  timeout: 5000,
  headers: {
    "Content-Type": "application/json",
  },
});
