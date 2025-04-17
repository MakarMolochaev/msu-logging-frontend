import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import './App.css';

// Импортируем типы для MediaRecorder
/// <reference types="dom-mediacapture-record" />

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
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingStatus, setRecordingStatus] = useState<string>('');
  const intervalRef = useRef<NodeJS.Timeout>();
  const retryCountRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const MAX_RETRIES = 3;

  // Очищаем интервал и соединения при размонтировании компонента
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
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

  const startRecording = async () => {
    try {
      setError('');
      retryCountRef.current = 0;
      setRecordingStatus('Подготовка к записи...');
      
      // Получаем токен
      const tokenResponse = await axios.get('http://localhost:8082/token', {
        withCredentials: true,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      // Получаем доступ к микрофону
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // Создаем MediaRecorder
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      
      // Устанавливаем WebSocket соединение
      const ws = new WebSocket(`wss://localhost:8081/ws?token=${tokenResponse.data.token}`);
      wsRef.current = ws;
      
      ws.onopen = () => {
        setRecordingStatus('Запись начата');
        setIsRecording(true);
        
        // Начинаем запись
        mediaRecorder.start(1000); // Отправляем данные каждую секунду
        
        // Запускаем проверку статуса
        setIsProcessing(true);
        checkTaskStatus();
      };
      
      ws.onerror = (error: Event) => {
        console.error('WebSocket error:', error);
        setError('Ошибка соединения с сервером');
        stopRecording();
      };
      
      ws.onclose = () => {
        console.log('WebSocket connection closed');
        stopRecording();
      };
      
      // Обработка данных с микрофона
      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(event.data);
        }
      };
      
    } catch (error) {
      console.error('Error starting recording:', error);
      setError('Не удалось начать запись. Проверьте доступ к микрофону и подключение к серверу.');
      stopRecording();
    }
  };
  
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    
    setIsRecording(false);
    setRecordingStatus('Запись остановлена');
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
        // Если запись была активна, останавливаем её
        if (isRecording) {
          stopRecording();
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
      <h1>Обработка аудио</h1>
      
      <div className="tabs">
        <div className="tab active">Загрузка файла</div>
        <div className="tab">Запись аудио</div>
      </div>
      
      <div className="content-section">
        <h2>Загрузка аудиофайла</h2>
        <div className="upload-section">
          <input
            type="file"
            accept="audio/*"
            onChange={handleFileUpload}
            disabled={isProcessing || isRecording}
          />
        </div>
        
        <h2>Запись аудио</h2>
        <div className="recording-section">
          {!isRecording ? (
            <button 
              className="record-button"
              onClick={startRecording}
              disabled={isProcessing}
            >
              Начать запись
            </button>
          ) : (
            <button 
              className="stop-button"
              onClick={stopRecording}
            >
              Остановить запись
            </button>
          )}
          {recordingStatus && <p className="recording-status">{recordingStatus}</p>}
        </div>
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