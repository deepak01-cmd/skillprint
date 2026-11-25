Put a language model file (.gguf) in this folder and Skillprint uses it to draft role profiles. Nothing to install.

Recommended: Qwen2.5 3B Instruct, Q4_K_M (about 2 GB):
  https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF  ->  qwen2.5-3b-instruct-q4_k_m.gguf
A 7B file (about 4.7 GB) writes better drafts but needs 8 GB of free memory and is slower.

Already downloaded Qwen with Ollama? The model is the largest file in
  %USERPROFILE%\.ollama\models\blobs   (a name like sha256-1a2b3c...)
Copy it here and rename it to qwen2.5-3b.gguf.

If several .gguf files are here, the largest is used. Restart the app after adding a file.
