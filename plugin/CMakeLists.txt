# CS80 plugin (the cs80v2 engine): AUv2 instrument (macOS), VST3 and Standalone, on JUCE 9.
#
#   cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
#   cmake --build build
#
# JUCE is fetched as a pinned release tarball (sha256 checked). For an offline
# build, point FETCHCONTENT_SOURCE_DIR_JUCE at an unpacked JUCE 9.0.5.
# CS80_SHARED_PRESETS=ON leaves out the 34 Arturia CS-80V translations.
# Windows: the editor uses WebView2 with the loader linked statically. Install
# the Microsoft.Web.WebView2 NuGet package and pass its folder's parent as
# -DJUCE_WEBVIEW2_PACKAGE_LOCATION=... (see .github/workflows/plugin.yml).
cmake_minimum_required(VERSION 3.22)
project(CS80 VERSION 0.2.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(APPLE AND NOT CMAKE_OSX_DEPLOYMENT_TARGET)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "" FORCE)
endif()

option(CS80_SHARED_PRESETS "Leave the Arturia-derived presets out" OFF)
option(CS80_BUILD_TESTS "Build the headless VST3 render host" OFF)

# the VST3 moduleinfo helper has to run on the build machine
if(CMAKE_CROSSCOMPILING)
    set(CS80_VST3_MANIFEST FALSE)
else()
    set(CS80_VST3_MANIFEST TRUE)
endif()

include(FetchContent)
FetchContent_Declare(JUCE
    URL https://github.com/juce-framework/JUCE/archive/refs/tags/9.0.5.tar.gz
    URL_HASH SHA256=d92207f51ba728d3d195b6d5e93ecd049717a915fc250ff6844c32ea7272315a
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(JUCE)

set(CS80_FORMATS VST3 Standalone)
if(APPLE)
    list(PREPEND CS80_FORMATS AU)
endif()

# AU codes and parameter IDs are permanent once a song uses them. Hosts list
# it as leblancfg > CS80. (v0 was "Vile: CS80v2", aumu Cs8v Vile.)
juce_add_plugin(CS80
    PRODUCT_NAME "CS80"
    COMPANY_NAME "leblancfg"
    BUNDLE_ID "sh.leblanc.cs80"
    PLUGIN_MANUFACTURER_CODE Lbfg
    PLUGIN_CODE Cs80
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    NEEDS_WEB_BROWSER TRUE
    NEEDS_WEBVIEW2 TRUE
    COPY_PLUGIN_AFTER_BUILD FALSE
    VST3_AUTO_MANIFEST ${CS80_VST3_MANIFEST}
    AU_MAIN_TYPE kAudioUnitType_MusicDevice
    VST3_CATEGORIES Instrument Synth
    DESCRIPTION "8-voice CS-80 recreation"
    FORMATS ${CS80_FORMATS})

# the faceplate page, served to the WebView from the binary (no network)
juce_add_binary_data(CS80UI SOURCES ui/index.html ui/face.css ui/face-defs.js ui/face.js)
set_target_properties(CS80UI PROPERTIES POSITION_INDEPENDENT_CODE ON)

target_sources(CS80 PRIVATE
    Source/EngineHost.cpp
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp)

# the engine is tuned and checked with -ffast-math (host, ESP32 and web builds)
if(MSVC AND CMAKE_CXX_COMPILER_ID STREQUAL "Clang")
    set(CS80_FAST_MATH "/clang:-ffast-math")
elseif(MSVC)
    set(CS80_FAST_MATH "/fp:fast")
else()
    set(CS80_FAST_MATH "-ffast-math")
endif()
set_source_files_properties(Source/EngineHost.cpp PROPERTIES COMPILE_OPTIONS "${CS80_FAST_MATH}")

target_compile_definitions(CS80 PUBLIC
    CS80_NO_STATIC_FX=1
    CS80_CHORUS_LEN=2048
    CS80_LIM_DMAX=256
    CS80_SHARED_PRESETS=$<BOOL:${CS80_SHARED_PRESETS}>
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0)
if(WIN32)
    target_compile_definitions(CS80 PUBLIC JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)
endif()

target_link_libraries(CS80
    PRIVATE CS80UI juce::juce_audio_utils juce::juce_gui_extra
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)

if(CS80_BUILD_TESTS)
    juce_add_console_app(cs80_vst3_render PRODUCT_NAME "cs80_vst3_render")
    target_sources(cs80_vst3_render PRIVATE tools/vst3_render.cpp)
    target_compile_definitions(cs80_vst3_render PRIVATE
        JUCE_PLUGINHOST_VST3=1 JUCE_PLUGINHOST_AU=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(cs80_vst3_render PRIVATE juce::juce_audio_processors juce::juce_audio_utils
        juce::juce_recommended_config_flags)

    juce_add_console_app(cs80_editor_check PRODUCT_NAME "cs80_editor_check")
    target_sources(cs80_editor_check PRIVATE tools/editor_check.cpp)
    target_compile_definitions(cs80_editor_check PRIVATE
        JUCE_PLUGINHOST_VST3=1 JUCE_PLUGINHOST_AU=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_MODAL_LOOPS_PERMITTED=1)
    target_link_libraries(cs80_editor_check PRIVATE juce::juce_audio_processors juce::juce_audio_utils
        juce::juce_recommended_config_flags)
endif()
