CXX = emcc
CXXFLAGS = -O3 --bind -std=c++17
LDFLAGS = -s ALLOW_MEMORY_GROWTH=1 \
          -s MODULARIZE=1 \
          -s EXPORT_ES6=1 \
          -s ENVIRONMENT=web \
          -s EXPORTED_RUNTIME_METHODS='["wasmMemory"]'

SRCS = wasm_main.cpp GameState.cpp SDFEngine.cpp
TARGET = game_core.js

all: $(TARGET)

$(TARGET): $(SRCS)
	$(CXX) $(CXXFLAGS) $(SRCS) -o $(TARGET) $(LDFLAGS)

clean:
	rm -f game_core.js game_core.wasm

.PHONY: all clean
