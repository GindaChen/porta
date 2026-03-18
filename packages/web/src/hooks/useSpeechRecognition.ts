/**
 * Hook for speech recognition via MediaRecorder + server-side transcription.
 *
 * Uses MediaRecorder API (available on ALL browsers including iOS Safari)
 * to record audio, then sends it to the Porta proxy which forwards to
 * DeepInfra or ElevenLabs for transcription.
 *
 * Falls back to Web Speech API on browsers that support it when no
 * server-side API key is configured.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { api } from "../api/client";

// Web Speech API (Chrome/Edge only, used as fallback)
const SpeechRecognitionCtor =
  (typeof window !== "undefined" &&
    ((window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition)) ||
  null;

// MediaRecorder is available on all modern browsers
const mediaRecorderSupported =
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined";

interface UseSpeechRecognitionOptions {
  /** Called with finalized transcript text to append to the draft */
  onTranscript: (text: string) => void;
  /** Language for recognition (default: "en-US") — used for Web Speech API fallback */
  lang?: string;
}

type RecordingState = "idle" | "recording" | "transcribing";

export function useSpeechRecognition({
  onTranscript,
  lang = "en-US",
}: UseSpeechRecognitionOptions) {
  const [state, setState] = useState<RecordingState>("idle");
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Refs for MediaRecorder approach
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Ref for Web Speech API fallback
  const recognitionRef = useRef<any>(null);

  // Track which mode we're using
  const modeRef = useRef<"server" | "webspeech" | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  /** Stop MediaRecorder and transcribe via server. */
  const stopMediaRecorder = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      // onStop handler processes the audio
    }
  }, []);

  /** Start recording via MediaRecorder (server-side transcription). */
  const startMediaRecorder = useCallback(async () => {
    setError(null);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Prefer webm/opus, fall back to whatever is available
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "";

      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        // Release mic
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const chunks = chunksRef.current;
        if (chunks.length === 0) {
          setState("idle");
          return;
        }

        const audioBlob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });

        setState("transcribing");
        setInterimText("Transcribing…");

        try {
          const result = await api.transcribe(audioBlob);
          if (result.text) {
            onTranscript(result.text);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Transcription failed";
          setError(msg);
          console.warn("Transcription error:", msg);
        } finally {
          setState("idle");
          setInterimText("");
        }
      };

      recorder.onerror = () => {
        setState("idle");
        setError("Recording failed");
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start();
      setState("recording");
      modeRef.current = "server";
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Microphone access denied";
      setError(msg);
      setState("idle");
    }
  }, [onTranscript]);

  /** Start Web Speech API (Chrome/Edge fallback). */
  const startWebSpeech = useCallback(() => {
    if (!SpeechRecognitionCtor) return;

    setError(null);

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setState("recording");

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      if (finalTranscript) {
        onTranscript(finalTranscript);
        setInterimText("");
      } else {
        setInterimText(interim);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        console.warn("Speech recognition error:", event.error);
      }
      setState("idle");
      setInterimText("");
    };

    recognition.onend = () => {
      setState("idle");
      setInterimText("");
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    modeRef.current = "webspeech";

    try {
      recognition.start();
    } catch {
      setState("idle");
    }
  }, [lang, onTranscript]);

  const stopWebSpeech = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setState("idle");
    setInterimText("");
  }, []);

  /** Toggle recording on/off. Prefers MediaRecorder; falls back to Web Speech API. */
  const toggle = useCallback(() => {
    if (state === "recording") {
      // Stop whatever mode is active
      if (modeRef.current === "server") {
        stopMediaRecorder();
      } else {
        stopWebSpeech();
      }
      return;
    }

    if (state === "transcribing") {
      // Already processing, ignore
      return;
    }

    // Start: prefer server-side (MediaRecorder) if available
    if (mediaRecorderSupported) {
      startMediaRecorder();
    } else if (SpeechRecognitionCtor) {
      startWebSpeech();
    }
  }, [state, startMediaRecorder, startWebSpeech, stopMediaRecorder, stopWebSpeech]);

  const isSupported = mediaRecorderSupported || !!SpeechRecognitionCtor;

  return {
    isSupported,
    isListening: state === "recording",
    isTranscribing: state === "transcribing",
    interimText,
    error,
    toggle,
  };
}
