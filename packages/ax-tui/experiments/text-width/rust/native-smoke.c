#include <stdint.h>
#include <stdio.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#endif

typedef uint32_t (*get_number)(void);
typedef void (*release_lease)(void);
typedef uint8_t *(*get_input)(void);
typedef uint32_t *(*get_ranges)(void);
typedef const uint32_t *(*get_widths)(void);
typedef uint32_t (*measure_batch)(uint32_t, uint32_t, uint32_t, uint32_t);

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "Usage: native-smoke PATH_TO_RUST_LIBRARY\n");
        return 1;
    }

#ifdef _WIN32
    HMODULE library = LoadLibraryA(argv[1]);
#define SYMBOL(name) GetProcAddress(library, name)
#else
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
#define SYMBOL(name) dlsym(library, name)
#endif
    if (!library) {
#ifdef _WIN32
        fprintf(stderr, "LoadLibrary failed: %lu\n", GetLastError());
#else
        fprintf(stderr, "dlopen failed: %s\n", dlerror());
#endif
        return 1;
    }

    get_number abi = (get_number)SYMBOL("kernelAbiVersion");
    get_number byte_capacity = (get_number)SYMBOL("kernelByteCapacity");
    get_number item_capacity = (get_number)SYMBOL("kernelItemCapacity");
    get_number acquire = (get_number)SYMBOL("kernelAcquire");
    release_lease release = (release_lease)SYMBOL("kernelRelease");
    get_input input = (get_input)SYMBOL("kernelInput");
    get_ranges ranges = (get_ranges)SYMBOL("kernelRanges");
    get_widths widths = (get_widths)SYMBOL("kernelWidths");
    measure_batch measure = (measure_batch)SYMBOL("kernelMeasure");
    if (!abi || !byte_capacity || !item_capacity || !acquire || !release || !input || !ranges || !widths || !measure ||
        abi() != 1 || byte_capacity() != 1024 * 1024 || item_capacity() != 4096 ||
        acquire() != 1 || acquire() != 0) {
        fprintf(stderr, "Wrong Rust width ABI or lease state\n");
        return 1;
    }

    memcpy(input(), "a\xe4\xb8\xad", 4);
    uint32_t *range = ranges();
    range[0] = 0;
    range[1] = 1;
    range[2] = 1;
    range[3] = 3;
    if (measure(2, 4, 4, 0) != 0 || widths()[0] != 1 || widths()[1] != 2) {
        fprintf(stderr, "Unexpected Rust width result\n");
        return 1;
    }
    range[1] = 4;
    range[2] = 2;
    range[3] = 1;
    if (measure(2, 4, 4, 0) != 3 || widths()[0] != 1 || widths()[1] != 2) {
        fprintf(stderr, "Invalid UTF-8 modified batch output\n");
        return 1;
    }
    release();
    if (acquire() != 1) {
        fprintf(stderr, "Rust width lease was not reusable\n");
        return 1;
    }
    release();
#ifdef _WIN32
    if (!FreeLibrary(library)) return 1;
#else
    if (dlclose(library) != 0) return 1;
#endif
    puts("AX_TUI_RUST_WIDTH_NATIVE_SMOKE_COMPLETE");
    return 0;
}
