/* Minimal SMF reader: format 0/1, merges tracks, honours tempo changes.
   Same code as in ../render.cpp. */
#pragma once
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iterator>
#include <vector>

struct Ev { double t; uint8_t st, d1, d2; };

static inline uint32_t be32(uint8_t const* p) { return (p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]; }
static inline uint16_t be16(uint8_t const* p) { return (p[0] << 8) | p[1]; }

static inline bool read_smf(char const* path, std::vector<Ev>& out, double& end_s)
{
    std::ifstream f(path, std::ios::binary);
    std::vector<uint8_t> b((std::istreambuf_iterator<char>(f)), {});
    if (b.size() < 14 || memcmp(&b[0], "MThd", 4) != 0) return false;
    uint16_t ntrk = be16(&b[10]), ppq = be16(&b[12]);
    struct Raw { uint64_t tick; int seq; uint8_t st, d1, d2; uint32_t tempo; };
    std::vector<Raw> raw;
    uint64_t end_tick = 0;
    size_t pos = 8 + be32(&b[4]);
    int seq = 0;
    for (int t = 0; t < ntrk && pos + 8 <= b.size(); ++t) {
        uint32_t len = be32(&b[pos + 4]);
        size_t p = pos + 8, e = p + len;
        uint64_t tick = 0;
        uint8_t run = 0;
        while (p < e) {
            uint32_t dt = 0;
            uint8_t c;
            do { c = b[p++]; dt = (dt << 7) | (c & 0x7f); } while (c & 0x80);
            tick += dt;
            uint8_t st = b[p];
            if (st & 0x80) ++p; else st = run;
            if (st == 0xff) {
                uint8_t type = b[p++];
                uint32_t l = 0;
                do { c = b[p++]; l = (l << 7) | (c & 0x7f); } while (c & 0x80);
                if (type == 0x51) raw.push_back({tick, seq++, 0xff, 0, 0, (uint32_t)((b[p] << 16) | (b[p + 1] << 8) | b[p + 2])});
                p += l;
            } else if (st == 0xf0 || st == 0xf7) {
                uint32_t l = 0;
                do { c = b[p++]; l = (l << 7) | (c & 0x7f); } while (c & 0x80);
                p += l;
            } else {
                run = st;
                int n = ((st & 0xf0) == 0xc0 || (st & 0xf0) == 0xd0) ? 1 : 2;
                uint8_t d1 = b[p++], d2 = n == 2 ? b[p++] : 0;
                raw.push_back({tick, seq++, st, d1, d2, 0});
            }
        }
        end_tick = std::max(end_tick, tick);
        pos = e;
    }
    std::stable_sort(raw.begin(), raw.end(), [](Raw const& a, Raw const& b) { return a.tick < b.tick; });
    double us_per_q = 500000.0, sec = 0.0;
    uint64_t last = 0;
    for (auto const& r : raw) {
        sec += (r.tick - last) * us_per_q / 1e6 / ppq;
        last = r.tick;
        if (r.st == 0xff) us_per_q = r.tempo;
        else out.push_back({sec, r.st, r.d1, r.d2});
    }
    end_s = sec + (end_tick - last) * us_per_q / 1e6 / ppq;
    return true;
}

