<template>
    <section class="p-4">
        <h2 class="text-2xl font-semibold mb-4">Автоматический настройщик</h2>
        <div class="flex flex-wrap gap-3">
            <UButton size="xl" class="text-base" icon="i-lucide-zap" :disabled="busy" @click="chooseHex"
                >Выбрать HEX и прошить</UButton
            >
            <UButton
                size="xl"
                class="text-base"
                icon="i-lucide-file-check"
                :loading="busy"
                :disabled="busy"
                @click="chooseDump"
                >Загрузить дамп и проверить</UButton
            >
        </div>
        <p v-if="error" role="alert">{{ error }}</p>
        <UModal v-model:open="dumpDeviceSelectionOpen" title="Выберите полётник для загрузки дампа">
            <template #body>
                <p class="mb-3">Выберите USB COM-порт полётника в обычном режиме, не DFU.</p>
                <UButton @click="selectDumpDevice">Выбрать USB COM-порт</UButton>
                <p v-if="deviceError" role="alert">{{ deviceError }}</p>
            </template>
        </UModal>
        <UModal v-model:open="deviceSelectionOpen" title="Выберите полётник">
            <template #body>
                <p class="mb-3">Выберите COM-порт полётника или USB DFU, если он уже в загрузчике.</p>
                <div class="flex flex-wrap gap-3">
                    <UButton @click="selectDevice('serial')">Выбрать COM-порт</UButton>
                    <UButton @click="selectDevice('usb')">Выбрать USB DFU</UButton>
                </div>
                <p v-if="error" role="alert">{{ error }}</p>
            </template>
        </UModal>
    </section>
</template>

<script setup lang="ts">
import { useDdProgrammer } from "../composables/useDdProgrammer";
import { useDdDump } from "../composables/useDdDump";
const { chooseHex, error, deviceSelectionOpen, selectDevice } = useDdProgrammer();
const { chooseDump, busy, dumpDeviceSelectionOpen, selectDumpDevice, deviceError } = useDdDump();
</script>
