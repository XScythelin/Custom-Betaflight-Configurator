<template>
    <UModal v-model:open="accConfirmation" title="Калибровка акселерометра">
        <template #body>
            <p>
                Снимите пропеллеры. Положите плату или собранный аппарат горизонтально, в нормальном полётном положении.
                Не двигайте во время калибровки.
            </p>
            <UButton class="mt-3" :disabled="busy" @click="startAcc">Плата лежит ровно — калибровать</UButton>
        </template>
    </UModal>
    <UModal v-model:open="opened" title="Настройка полётника" :dismissible="!busy">
        <template #body>
            <p v-if="message" role="status">{{ message }}</p>
            <template v-if="needsPort">
                <p class="mb-3">Выберите USB COM-порт полётника. Нужен обычный режим, не DFU.</p>
                <UButton @click="selectPort">Выбрать COM-порт</UButton>
            </template>
        </template>
    </UModal>
</template>

<script setup lang="ts">
import { useDdQuickActions } from "../composables/useDdQuickActions";
const { busy, opened, message, needsPort, accConfirmation, perform, selectPort } = useDdQuickActions();
function startAcc() {
    accConfirmation.value = false;
    void perform("acc");
}
</script>
