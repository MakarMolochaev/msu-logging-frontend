import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import './App.css';

// Настраиваем axios для работы с куками
axios.defaults.withCredentials = true;

interface TaskStatus {
  task_status: string;
  status: string;
  error?: string;
  full_protocol?: string;
  short_protocol?: string;
}

function App() {
  const [status, setStatus] = useState<string>('');
  const [fullProtocol, setFullProtocol] = useState<string>('');
  const [shortProtocol, setShortProtocol] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const intervalRef = useRef<NodeJS.Timeout>();
  const retryCountRef = useRef<number>(0);
  const MAX_RETRIES = 3;

  // Очищаем интервал при размонтировании компонента
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setError('');
      retryCountRef.current = 0;
      
      // Очищаем предыдущий интервал, если он существует
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      
      // Получаем токен
      await axios.get('http://localhost:8082/token', {
        withCredentials: true,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      // Отправляем файл
      const formData = new FormData();
      formData.append('audioFile', file);
      await axios.post('http://localhost:8082/loadaudio', formData, {
        withCredentials: true,
        headers: {
          'Accept': 'application/json'
        }
      });

      // Запускаем проверку статуса
      setIsProcessing(true);
      checkTaskStatus();
    } catch (error) {
      console.error('Error uploading file:', error);
      setStatus('Ошибка при загрузке файла');
      setError('Произошла ошибка при загрузке файла. Проверьте подключение к серверу.');
      setIsProcessing(false);
    }
  };

  const checkTaskStatus = async () => {
    try {
      const response = await axios.get<TaskStatus>('http://localhost:8082/taskstatus', {
        withCredentials: true,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      const { task_status, status: responseStatus, error: responseError, full_protocol, short_protocol } = response.data;
      
      setStatus(task_status);
      retryCountRef.current = 0; // Сбрасываем счетчик при успешном запросе

      if (responseStatus === 'Error') {
        setError(responseError || 'Произошла неизвестная ошибка');
        setIsProcessing(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        return;
      }

      if (task_status === 'finished') {
        setFullProtocol(full_protocol || '');
        setShortProtocol(short_protocol || '');
        setIsProcessing(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      } else if (!intervalRef.current) {
        // Создаем интервал только если его еще нет
        intervalRef.current = setInterval(checkTaskStatus, 1000);
      }
    } catch (error) {
      console.error('Error checking task status:', error);
      
      // Увеличиваем счетчик попыток
      retryCountRef.current += 1;
      
      if (retryCountRef.current >= MAX_RETRIES) {
        setStatus('Ошибка при проверке статуса');
        setError('Не удалось получить статус задачи после нескольких попыток. Проверьте подключение к серверу.');
        setIsProcessing(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        return;
      }
      
      // Если не превышен лимит попыток, продолжаем проверку
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      intervalRef.current = setInterval(checkTaskStatus, 1000);
    }
  };

  return (
    <div className="App">
      <h1>Загрузка аудиофайла</h1>
      <div className="upload-section">
        <input
          type="file"
          accept="audio/*"
          onChange={handleFileUpload}
          disabled={isProcessing}
        />
      </div>
      
      {status && (
        <div className="status-section">
          <h2>Статус обработки:</h2>
          <p>{status}</p>
        </div>
      )}

      {error && (
        <div className="error-section">
          <h2>Ошибка:</h2>
          <p>{error}</p>
        </div>
      )}

      {fullProtocol && (
        <div className="protocol-section">
          <h2>Ссылки для скачивания:</h2>
          <a href={fullProtocol} target="_blank" rel="noopener noreferrer">
            Скачать полный протокол
          </a>
          <br />
          <a href={shortProtocol} target="_blank" rel="noopener noreferrer">
            Скачать краткий протокол
          </a>
        </div>
      )}
    </div>
  );
}

export default App; 